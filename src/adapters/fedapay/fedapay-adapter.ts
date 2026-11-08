import { BaseGatewayAdapter } from '../../core/base-adapter.js';
import {
  CreatePaymentInput,
  PaymentInitializationResult,
  PaymentVerificationResult,
  TransactionStatus,
  Currency,
  AfricanCountryCode,
} from '../../types/payment.js';
import { FedaPayConfig, GatewayCapabilities } from '../../types/gateway.js';
import { NormalizedWebhookEvent } from '../../types/webhook.js';
import {
  FedaPayCreateTransactionResponse,
  FedaPayTokenResponse,
  FedaPayTransactionResponse,
  FedaPayWebhookPayload,
} from './types.js';
import { GatewayError, InvalidSignatureError } from '../../errors/unipay-error.js';
import { computeHmacSha256, safeEqual } from '../../utils/crypto.js';

export class FedaPayAdapter extends BaseGatewayAdapter<FedaPayConfig> {
  public readonly provider = 'fedapay';

  public readonly capabilities: GatewayCapabilities = {
    supportedCurrencies: ['XOF'],
    supportedCountries: ['BJ', 'CI', 'SN', 'TG', 'NE', 'ML', 'BF'],
    supportsWebhooks: true,
    supportsRefunds: true,
  };

  private get baseUrl(): string {
    const isSandbox =
      this.config.environment === 'sandbox' ||
      this.config.isSandbox ||
      this.config.apiKey.startsWith('sk_sandbox_');
    return isSandbox ? 'https://sandbox-api.fedapay.com/v1' : 'https://api.fedapay.com/v1';
  }

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  public async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
    // 1. Créer la transaction FedaPay
    const createUrl = `${this.baseUrl}/transactions`;
    const payload = {
      description: input.description,
      amount: input.amount,
      currency: {
        iso: input.currency,
      },
      callback_url: input.returnUrl,
      customer: {
        firstname: input.customer.firstName,
        lastname: input.customer.lastName,
        email: input.customer.email,
        phone_number: {
          number: input.customer.phoneNumber,
        },
      },
      custom_metadata: {
        merchant_reference: input.reference,
        ...input.metadata,
      },
    };

    const txResponse = await this.request<FedaPayCreateTransactionResponse | { transaction: FedaPayTransactionResponse }>(
      createUrl,
      {
        method: 'POST',
        headers: this.authHeaders,
        body: payload,
      }
    );

    const transaction =
      (txResponse as FedaPayCreateTransactionResponse)['v1/transaction'] ||
      (txResponse as { transaction: FedaPayTransactionResponse }).transaction;

    if (!transaction || !transaction.id) {
      throw new GatewayError(this.provider, 'Failed to create transaction on FedaPay', {
        rawResponse: txResponse,
      });
    }

    // 2. Générer le jeton / URL de redirection de paiement
    const tokenUrl = `${this.baseUrl}/transactions/${transaction.id}/token`;
    const tokenResponse = await this.request<FedaPayTokenResponse>(tokenUrl, {
      method: 'POST',
      headers: this.authHeaders,
    });

    return {
      provider: this.provider,
      providerTransactionId: String(transaction.id),
      reference: input.reference,
      paymentUrl: tokenResponse.url,
      token: tokenResponse.token,
      status: this.mapFedaPayStatus(transaction.status),
      rawResponse: { transaction, token: tokenResponse },
    };
  }

  public async verifyPayment(transactionId: string): Promise<PaymentVerificationResult> {
    const url = `${this.baseUrl}/transactions/${transactionId}`;
    const response = await this.request<FedaPayCreateTransactionResponse | { transaction: FedaPayTransactionResponse }>(
      url,
      {
        method: 'GET',
        headers: this.authHeaders,
      }
    );

    const tx =
      (response as FedaPayCreateTransactionResponse)['v1/transaction'] ||
      (response as { transaction: FedaPayTransactionResponse }).transaction;

    if (!tx) {
      throw new GatewayError(this.provider, `Transaction ${transactionId} not found on FedaPay`);
    }

    const merchantRef =
      (tx.custom_metadata?.merchant_reference as string) || tx.reference || String(tx.id);

    return {
      provider: this.provider,
      providerTransactionId: String(tx.id),
      reference: merchantRef,
      status: this.mapFedaPayStatus(tx.status),
      amount: tx.amount,
      currency: (tx.currency?.iso as Currency) || 'XOF',
      paidAt: tx.status === 'approved' ? new Date(tx.updated_at) : undefined,
      customer: {
        firstName: tx.customer?.firstname,
        lastName: tx.customer?.lastname,
        email: tx.customer?.email,
        phoneNumber: tx.customer?.phone_number?.number,
      },
      rawResponse: tx,
    };
  }

  public async parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<NormalizedWebhookEvent> {
    const data = payload as FedaPayWebhookPayload;

    if (!data || !data.entity || !data.name) {
      throw new GatewayError(this.provider, 'Invalid FedaPay webhook payload format');
    }

    const tx = data.entity;
    const status = this.mapFedaPayStatus(tx.status);
    const merchantRef =
      (tx.custom_metadata?.merchant_reference as string) || tx.reference || String(tx.id);

    let eventType: NormalizedWebhookEvent['eventType'] = 'payment.pending';
    if (status === 'SUCCESSFUL') {
      eventType = 'payment.success';
    } else if (status === 'FAILED') {
      eventType = 'payment.failed';
    } else if (status === 'CANCELLED') {
      eventType = 'payment.cancelled';
    }

    return {
      eventId: `${this.provider}_${tx.id}_${Date.now()}`,
      provider: this.provider,
      eventType,
      status,
      reference: merchantRef,
      providerTransactionId: String(tx.id),
      amount: tx.amount,
      currency: (tx.currency?.iso as Currency) || 'XOF',
      timestamp: new Date(tx.updated_at || tx.created_at || Date.now()),
      metadata: tx.custom_metadata,
      customer: {
        firstName: tx.customer?.firstname,
        lastName: tx.customer?.lastname,
        email: tx.customer?.email,
        phoneNumber: tx.customer?.phone_number?.number,
      },
      rawPayload: payload,
    };
  }

  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret?: string
  ): boolean {
    const webhookSecret = secret || this.config.webhookSecret;
    if (!webhookSecret) {
      // Si aucun secret n'est fourni, on émet un avertissement ou vérification désactivée
      return true;
    }

    if (!signatureHeader) {
      return false;
    }

    // Le format d'en-tête FedaPay peut être: "s=hexHash" ou "t=timestamp,s=signature" ou directement le hash
    let expectedSig = signatureHeader;
    if (signatureHeader.includes('s=')) {
      const match = signatureHeader.match(/s=([a-f0-9]+)/i);
      if (match) {
        expectedSig = match[1];
      }
    }

    const computed = computeHmacSha256(rawBody, webhookSecret, 'hex');
    return safeEqual(computed.toLowerCase(), expectedSig.toLowerCase());
  }

  private mapFedaPayStatus(status: FedaPayTransactionResponse['status']): TransactionStatus {
    switch (status) {
      case 'approved':
      case 'transferred':
        return 'SUCCESSFUL';
      case 'declined':
        return 'FAILED';
      case 'canceled':
        return 'CANCELLED';
      case 'pending':
      default:
        return 'PENDING';
    }
  }
}
