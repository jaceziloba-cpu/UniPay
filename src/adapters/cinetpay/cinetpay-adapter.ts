import { BaseGatewayAdapter } from '../../core/base-adapter.js';
import {
  CreatePaymentInput,
  PaymentInitializationResult,
  PaymentVerificationResult,
  TransactionStatus,
  Currency,
} from '../../types/payment.js';
import { CinetPayConfig, GatewayCapabilities } from '../../types/gateway.js';
import { NormalizedWebhookEvent } from '../../types/webhook.js';
import {
  CinetPayInitResponse,
  CinetPayCheckResponse,
  CinetPayWebhookPayload,
} from './types.js';
import { GatewayError } from '../../errors/unipay-error.js';
import { computeHmacSha256, safeEqual } from '../../utils/crypto.js';

export class CinetPayAdapter extends BaseGatewayAdapter<CinetPayConfig> {
  public readonly provider = 'cinetpay';

  public readonly capabilities: GatewayCapabilities = {
    supportedCurrencies: ['XOF', 'XAF', 'CDF', 'GNF', 'USD'],
    supportedCountries: ['CI', 'SN', 'CM', 'BF', 'ML', 'TG', 'CD', 'GN', 'BJ'],
    supportsWebhooks: true,
    supportsRefunds: false,
  };

  private readonly baseUrl = 'https://api-checkout.cinetpay.com/v2';

  public async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
    const url = `${this.baseUrl}/payment`;

    // CinetPay requiert des informations géographiques minimales
    const country = input.customer.country || 'CI';
    const city = input.customer.city || 'Abidjan';
    const address = input.customer.address || 'Plateau';

    const payload = {
      apikey: this.config.apiKey,
      site_id: this.config.siteId,
      transaction_id: input.reference,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      notify_url: input.callbackUrl || input.returnUrl,
      return_url: input.returnUrl,
      channels: input.paymentMethod ? this.mapPaymentMethodToChannel(input.paymentMethod) : 'ALL',
      customer_name: input.customer.firstName,
      customer_surname: input.customer.lastName,
      customer_email: input.customer.email,
      customer_phone_number: input.customer.phoneNumber,
      customer_address: address,
      customer_city: city,
      customer_country: country,
      customer_state: country,
      customer_zip_code: '00225',
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    };

    const response = await this.request<CinetPayInitResponse>(url, {
      method: 'POST',
      body: payload,
    });

    if (response.code !== '201' || !response.data?.payment_url) {
      throw new GatewayError(
        this.provider,
        `CinetPay Initialization failed: ${response.message || response.description}`,
        {
          providerErrorCode: response.code,
          rawResponse: response,
        }
      );
    }

    return {
      provider: this.provider,
      providerTransactionId: input.reference,
      reference: input.reference,
      paymentUrl: response.data.payment_url,
      token: response.data.payment_token,
      status: 'PENDING',
      rawResponse: response,
    };
  }

  public async verifyPayment(transactionId: string): Promise<PaymentVerificationResult> {
    const url = `${this.baseUrl}/payment/check`;
    const payload = {
      apikey: this.config.apiKey,
      site_id: this.config.siteId,
      transaction_id: transactionId,
    };

    const response = await this.request<CinetPayCheckResponse>(url, {
      method: 'POST',
      body: payload,
    });

    if (response.code !== '00' || !response.data) {
      throw new GatewayError(
        this.provider,
        `Payment verification failed: ${response.message}`,
        {
          providerErrorCode: response.code,
          rawResponse: response,
        }
      );
    }

    const txData = response.data;
    const status = this.mapCinetPayStatus(txData.status);

    return {
      provider: this.provider,
      providerTransactionId: transactionId,
      reference: transactionId,
      status,
      amount: Number(txData.amount),
      currency: (txData.currency as Currency) || 'XOF',
      paidAt: txData.payment_date ? new Date(txData.payment_date) : undefined,
      paymentMethodUsed: txData.payment_method,
      rawResponse: response,
    };
  }

  public async parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<NormalizedWebhookEvent> {
    const data = payload as CinetPayWebhookPayload;

    const transactionId = (data.cpm_trans_id || data.transaction_id) as string;
    if (!transactionId) {
      throw new GatewayError(this.provider, 'Missing transaction identifier in CinetPay webhook');
    }

    // Sécurisation supplémentaire : CinetPay recommande de vérifier l'état réel auprès de l'API
    // pour garantir l'intégrité de la transaction contre les fausses requêtes webhook
    let status: TransactionStatus = 'PENDING';
    let amount = Number(data.cpm_amount || 0);
    let currency: Currency = (data.cpm_currency as Currency) || 'XOF';
    let paidDate: Date = new Date();

    try {
      const verified = await this.verifyPayment(transactionId);
      status = verified.status;
      amount = verified.amount;
      currency = verified.currency;
      if (verified.paidAt) {
        paidDate = verified.paidAt;
      }
    } catch {
      // Fallback sur les données du webhook si l'appel échoue temporairement
      if (data.cpm_result === '00' || data.cpm_trans_status === 'ACCEPTED') {
        status = 'SUCCESSFUL';
      } else if (data.cpm_result) {
        status = 'FAILED';
      }
    }

    let eventType: NormalizedWebhookEvent['eventType'] = 'payment.pending';
    if (status === 'SUCCESSFUL') {
      eventType = 'payment.success';
    } else if (status === 'FAILED') {
      eventType = 'payment.failed';
    } else if (status === 'CANCELLED') {
      eventType = 'payment.cancelled';
    }

    let parsedMetadata: Record<string, unknown> | undefined;
    if (typeof data.cpm_custom === 'string') {
      try {
        parsedMetadata = JSON.parse(data.cpm_custom);
      } catch {
        parsedMetadata = { custom: data.cpm_custom };
      }
    }

    return {
      eventId: `${this.provider}_${transactionId}_${Date.now()}`,
      provider: this.provider,
      eventType,
      status,
      reference: transactionId,
      providerTransactionId: transactionId,
      amount,
      currency,
      timestamp: paidDate,
      metadata: parsedMetadata,
      customer: {
        phoneNumber: data.cel_phone_num || (data.cpm_phone_prefixe ? `+${data.cpm_phone_prefixe}${data.cel_phone_num}` : undefined),
      },
      rawPayload: payload,
    };
  }

  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret?: string
  ): boolean {
    const secretKey = secret || this.config.secretKey;
    if (!secretKey) {
      return true;
    }

    if (!signatureHeader) {
      return false;
    }

    const computed = computeHmacSha256(rawBody, secretKey, 'hex');
    return safeEqual(computed.toLowerCase(), signatureHeader.toLowerCase());
  }

  private mapCinetPayStatus(status: string): TransactionStatus {
    switch (status?.toUpperCase()) {
      case 'ACCEPTED':
        return 'SUCCESSFUL';
      case 'REFUSED':
        return 'FAILED';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'WAITING_FOR_CUSTOMER':
      case 'WAITING_FOR_PAYMENT':
      default:
        return 'PENDING';
    }
  }

  private mapPaymentMethodToChannel(method: string): string {
    switch (method) {
      case 'mobile_money':
      case 'orange_money':
      case 'mtn_momo':
      case 'moov_money':
      case 'wave':
        return 'MOBILE_MONEY';
      case 'card':
        return 'CREDIT_CARD';
      default:
        return 'ALL';
    }
  }
}
