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
import { PayDunyaInitResponse, PayDunyaCheckResponse, PayDunyaWebhookPayload } from './types.js';
import { GatewayError, InvalidSignatureError } from '../../errors/unipay-error.js';
import { computeHmacSha256, safeEqual } from '../../utils/crypto.js';

export interface PayDunyaConfig extends BaseGatewayConfig {
  provider: 'paydunya';
  /** Clé Master (récupérée dans votre dashboard PayDunya > Setup > API Keys) */
  masterKey: string;
  /** Clé publique */
  publicKey: string;
  /** Clé privée */
  privateKey: string;
  /** Jeton de secret */
  token: string;
  /** Secret de webhook */
  webhookSecret?: string;
}

export class PayDunyaAdapter extends BaseGatewayAdapter<PayDunyaConfig> {
  public readonly provider = 'paydunya';

  public readonly capabilities: GatewayCapabilities = {
    supportedCurrencies: ['XOF'],
    supportedCountries: ['SN', 'CI', 'BJ', 'TG', 'ML', 'BF', 'GN', 'NE'],
    supportsWebhooks: true,
    supportsRefunds: false,
  };

  private get baseUrl(): string {
    return this.config.isSandbox
      ? 'https://app.paydunya.com/sandbox-api/v1'
      : 'https://app.paydunya.com/api/v1';
  }

  private get authHeaders(): Record<string, string> {
    return {
      'PAYDUNYA-MASTER-KEY': this.config.masterKey,
      'PAYDUNYA-PUBLIC-KEY': this.config.publicKey,
      'PAYDUNYA-PRIVATE-KEY': this.config.privateKey,
      'PAYDUNYA-TOKEN': this.config.token,
    };
  }

  public async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
    const url = `${this.baseUrl}/checkout-invoice/create`;

    const payload = {
      invoice: {
        total_amount: input.amount,
        description: input.description,
      },
      store: {
        name: input.metadata?.storeName || 'UniPay Store',
        tagline: input.description,
      },
      actions: {
        callback_url: input.callbackUrl,
        return_url: input.returnUrl,
        cancel_url: input.returnUrl,
      },
      customer: {
        name: `${input.customer.firstName} ${input.customer.lastName}`,
        phone: input.customer.phoneNumber,
        email: input.customer.email,
      },
      custom_data: {
        merchant_reference: input.reference,
        ...input.metadata,
      },
    };

    const response = await this.request<PayDunyaInitResponse>(url, {
      method: 'POST',
      headers: this.authHeaders,
      body: payload,
    });

    if (response.response_code !== '00') {
      throw new GatewayError(
        this.provider,
        `PayDunya initialization failed: ${response.response_text || response.description}`,
        { providerErrorCode: response.response_code, rawResponse: response }
      );
    }

    const token = response.token || response.invoice_token;
    if (!token) {
      throw new GatewayError(this.provider, 'PayDunya did not return a payment token', { rawResponse: response });
    }

    const baseCheckoutUrl = this.config.isSandbox
      ? 'https://app.paydunya.com/sandbox-checkout/invoice'
      : 'https://app.paydunya.com/checkout/invoice';

    return {
      provider: this.provider,
      providerTransactionId: token,
      reference: input.reference,
      paymentUrl: `${baseCheckoutUrl}/${token}`,
      token,
      status: 'PENDING',
      rawResponse: response,
    };
  }

  public async verifyPayment(transactionId: string): Promise<PaymentVerificationResult> {
    const url = `${this.baseUrl}/checkout-invoice/confirm/${transactionId}`;
    const response = await this.request<PayDunyaCheckResponse>(url, {
      method: 'GET',
      headers: this.authHeaders,
    });

    if (response.response_code !== '00' || !response.invoice) {
      throw new GatewayError(this.provider, `PayDunya verification failed: ${response.response_text}`, {
        providerErrorCode: response.response_code,
        rawResponse: response,
      });
    }

    const inv = response.invoice;
    const merchantRef = (response.custom_data?.merchant_reference as string) || transactionId;

    return {
      provider: this.provider,
      providerTransactionId: inv.token,
      reference: merchantRef,
      status: this.mapPayDunyaStatus(inv.status),
      amount: inv.total,
      currency: (inv.currency as Currency) || 'XOF',
      paidAt: inv.completed_at ? new Date(inv.completed_at) : undefined,
      customer: inv.customer
        ? {
            firstName: inv.customer.name.split(' ')[0],
            lastName: inv.customer.name.split(' ').slice(1).join(' '),
            email: inv.customer.email,
            phoneNumber: inv.customer.phone,
          }
        : undefined,
      rawResponse: response,
    };
  }

  public async parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<NormalizedWebhookEvent> {
    const data = payload as PayDunyaWebhookPayload;
    const inv = data?.data?.invoice;

    if (!inv?.token) {
      throw new GatewayError(this.provider, 'Invalid PayDunya webhook payload: missing invoice token');
    }

    const merchantRef = (inv.custom_data?.merchant_reference as string) || inv.token;
    const status = this.mapPayDunyaStatus(inv.status);

    let eventType: NormalizedWebhookEvent['eventType'] = 'payment.pending';
    if (status === 'SUCCESSFUL') eventType = 'payment.success';
    else if (status === 'FAILED') eventType = 'payment.failed';
    else if (status === 'CANCELLED') eventType = 'payment.cancelled';

    return {
      eventId: `${this.provider}_${inv.token}_${Date.now()}`,
      provider: this.provider,
      eventType,
      status,
      reference: merchantRef,
      providerTransactionId: inv.token,
      amount: inv.total,
      currency: (inv.currency as Currency) || 'XOF',
      timestamp: new Date(),
      metadata: inv.custom_data,
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

  private mapPayDunyaStatus(status: string): TransactionStatus {
    switch (status?.toLowerCase()) {
      case 'completed': return 'SUCCESSFUL';
      case 'failed': return 'FAILED';
      case 'cancelled': return 'CANCELLED';
      case 'pending': default: return 'PENDING';
    }
  }
}
