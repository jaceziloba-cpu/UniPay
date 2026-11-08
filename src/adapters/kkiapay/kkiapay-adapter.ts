import { BaseGatewayAdapter } from '../../core/base-adapter.js';
import {
  CreatePaymentInput,
  PaymentInitializationResult,
  PaymentVerificationResult,
  TransactionStatus,
  Currency,
} from '../../types/payment.js';
import { BaseGatewayConfig, GatewayCapabilities } from '../../types/gateway.js';
import { NormalizedWebhookEvent } from '../../types/webhook.js';
import { KkiapayInitResponse, KkiapayCheckResponse, KkiapayWebhookPayload } from './types.js';
import { GatewayError } from '../../errors/unipay-error.js';
import { computeHmacSha256, safeEqual } from '../../utils/crypto.js';

export interface KkiapayConfig extends BaseGatewayConfig {
  provider: 'kkiapay';
  /** Clé publique Kkiapay (récupérée dans Dashboard > API Keys) */
  publicKey: string;
  /** Clé privée Kkiapay */
  privateKey: string;
  /** Clé secrète pour vérification de webhooks */
  webhookSecret?: string;
}

export class KkiapayAdapter extends BaseGatewayAdapter<KkiapayConfig> {
  public readonly provider = 'kkiapay';

  public readonly capabilities: GatewayCapabilities = {
    // Kkiapay couvre l'UEMOA et le Cameroun (mobile money MTN, Moov, Orange, Wave)
    supportedCurrencies: ['XOF', 'XAF'],
    supportedCountries: ['BJ', 'CI', 'SN', 'TG', 'ML', 'BF', 'NE', 'GN', 'CM'],
    supportsWebhooks: true,
    supportsRefunds: true,
  };

  private get baseUrl(): string {
    return this.config.isSandbox
      ? 'https://api-sandbox.kkiapay.me/api/v1'
      : 'https://api.kkiapay.me/api/v1';
  }

  private get checkoutBaseUrl(): string {
    return this.config.isSandbox
      ? 'https://sandbox-checkout.kkiapay.me'
      : 'https://checkout.kkiapay.me';
  }

  private get authHeaders(): Record<string, string> {
    return {
      'x-public-key': this.config.publicKey,
      'x-secret-key': this.config.privateKey,
    };
  }

  public async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
    const url = `${this.baseUrl}/transactions/init`;

    const payload = {
      amount: input.amount,
      reason: input.description,
      name: `${input.customer.firstName} ${input.customer.lastName}`,
      email: input.customer.email,
      phone: input.customer.phoneNumber,
      successurl: input.returnUrl || 'https://localhost/success',
      failurl: input.returnUrl || 'https://localhost/fail',
      webhookurl: input.callbackUrl,
      data: {
        merchant_reference: input.reference,
        ...input.metadata,
      },
    };

    const response = await this.request<KkiapayInitResponse>(url, {
      method: 'POST',
      headers: this.authHeaders,
      body: payload,
    });

    if (!response.transactionId) {
      throw new GatewayError(
        this.provider,
        `Kkiapay initialization failed: ${response.message || 'No transaction ID returned'}`,
        { rawResponse: response }
      );
    }

    // Construire l'URL de paiement Kkiapay
    const paymentUrl = response.url ||
      response.payUrl ||
      `${this.checkoutBaseUrl}?key=${this.config.publicKey}&amount=${input.amount}&reason=${encodeURIComponent(input.description)}&callback=${encodeURIComponent(input.callbackUrl || '')}`;

    return {
      provider: this.provider,
      providerTransactionId: response.transactionId,
      reference: input.reference,
      paymentUrl,
      status: 'PENDING',
      rawResponse: response,
    };
  }

  public async verifyPayment(transactionId: string): Promise<PaymentVerificationResult> {
    const url = `${this.baseUrl}/transactions/${transactionId}/status`;
    const response = await this.request<KkiapayCheckResponse>(url, {
      method: 'GET',
      headers: this.authHeaders,
    });

    if (!response.transactionId) {
      throw new GatewayError(this.provider, `Kkiapay: transaction ${transactionId} not found`, {
        rawResponse: response,
      });
    }

    const merchantRef = (response.form?.merchant_reference as string) || transactionId;

    return {
      provider: this.provider,
      providerTransactionId: response.transactionId,
      reference: merchantRef,
      status: this.mapKkiapayStatus(response.status),
      amount: response.amount,
      currency: 'XOF',
      paidAt: response.paidAt ? new Date(response.paidAt) : undefined,
      paymentMethodUsed: response.paymentMethod,
      customer: response.client
        ? {
            firstName: response.client.name?.split(' ')[0],
            lastName: response.client.name?.split(' ').slice(1).join(' '),
            email: response.client.email,
            phoneNumber: response.client.phone,
          }
        : undefined,
      rawResponse: response,
    };
  }

  public async parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<NormalizedWebhookEvent> {
    const data = payload as KkiapayWebhookPayload;

    if (!data?.transactionId) {
      throw new GatewayError(this.provider, 'Invalid Kkiapay webhook: missing transactionId');
    }

    const merchantRef = (data.form?.merchant_reference as string) || data.transactionId;
    const status = this.mapKkiapayStatus(data.status || 'PENDING');

    let eventType: NormalizedWebhookEvent['eventType'] = 'payment.pending';
    if (status === 'SUCCESSFUL') eventType = 'payment.success';
    else if (status === 'FAILED') eventType = 'payment.failed';
    else if (status === 'CANCELLED') eventType = 'payment.cancelled';

    return {
      eventId: `${this.provider}_${data.transactionId}_${Date.now()}`,
      provider: this.provider,
      eventType,
      status,
      reference: merchantRef,
      providerTransactionId: data.transactionId,
      amount: data.amount || 0,
      currency: 'XOF',
      timestamp: new Date(),
      metadata: data.form as Record<string, unknown> | undefined,
      customer: data.client
        ? {
            firstName: data.client.name?.split(' ')[0],
            phoneNumber: data.client.phone,
            email: data.client.email,
          }
        : undefined,
      rawPayload: payload,
    };
  }

  public verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string, secret?: string): boolean {
    const webhookSecret = secret || this.config.webhookSecret;
    if (!webhookSecret) return true;
    if (!signatureHeader) return false;
    const computed = computeHmacSha256(rawBody, webhookSecret, 'hex');
    return safeEqual(computed.toLowerCase(), signatureHeader.toLowerCase());
  }

  private mapKkiapayStatus(status: string): TransactionStatus {
    switch (status?.toUpperCase()) {
      case 'SUCCESS': return 'SUCCESSFUL';
      case 'FAILED': return 'FAILED';
      case 'CANCELLED': return 'CANCELLED';
      case 'REFUNDED': return 'SUCCESSFUL';
      case 'PENDING': default: return 'PENDING';
    }
  }
}
