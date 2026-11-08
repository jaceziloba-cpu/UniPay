import {
  PaymentGatewayAdapter,
  GatewayProvider,
  GatewayCapabilities,
  BaseGatewayConfig,
  CreatePaymentInput,
  PaymentInitializationResult,
  PaymentVerificationResult,
} from '../types/index.js';
import { NormalizedWebhookEvent } from '../types/webhook.js';
import {
  GatewayError,
  NetworkError,
  AuthenticationError,
} from '../errors/unipay-error.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export abstract class BaseGatewayAdapter<TConfig extends BaseGatewayConfig = BaseGatewayConfig>
  implements PaymentGatewayAdapter
{
  public abstract readonly provider: GatewayProvider;
  public abstract readonly capabilities: GatewayCapabilities;

  protected readonly config: TConfig;

  constructor(config: TConfig) {
    this.config = {
      isSandbox: false,
      timeoutMs: 15000,
      maxRetries: 2,
      ...config,
    };
  }

  public abstract createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult>;
  public abstract verifyPayment(transactionId: string): Promise<PaymentVerificationResult>;
  public abstract parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<NormalizedWebhookEvent>;
  public abstract verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret?: string
  ): boolean;

  /**
   * Effectue une requête HTTP standardisée avec gestion de timeout, retries exponentiels et erreurs unifiées
   */
  protected async request<TResponse>(url: string, options: RequestOptions = {}): Promise<TResponse> {
    const { method = 'GET', headers = {}, body, timeoutMs = this.config.timeoutMs ?? 15000 } = options;
    const maxRetries = this.config.maxRetries ?? 2;
    let attempt = 0;

    const reqHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    let serializedBody: string | undefined;
    if (body !== undefined) {
      if (typeof body === 'string') {
        serializedBody = body;
      } else {
        reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
        serializedBody = JSON.stringify(body);
      }
    }

    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: reqHeaders,
          body: serializedBody,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const rawText = await response.text();
        const data = isJson && rawText ? JSON.parse(rawText) : rawText;

        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError(
            this.provider,
            `Credentials invalid or unauthorized (HTTP ${response.status}): ${typeof data === 'object' ? JSON.stringify(data) : rawText}`
          );
        }

        // Si le serveur renvoie 5xx ou 429 et qu'il reste des tentatives, réessayer avec backoff
        if ((response.status >= 500 || response.status === 429) && attempt <= maxRetries) {
          const delay = Math.pow(2, attempt) * 300 + Math.random() * 200;
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        if (!response.ok) {
          throw new GatewayError(this.provider, `HTTP ${response.status} Error`, {
            httpStatus: response.status,
            rawResponse: data,
          });
        }

        return data as TResponse;
      } catch (err: unknown) {
        clearTimeout(timer);

        if (err instanceof AuthenticationError || err instanceof GatewayError) {
          throw err;
        }

        const isAbort = (err as Error)?.name === 'AbortError';
        const isNetwork = !isAbort;

        if (attempt <= maxRetries && (isAbort || isNetwork)) {
          const delay = Math.pow(2, attempt) * 300 + Math.random() * 200;
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }

        if (isAbort) {
          throw new NetworkError(this.provider, `Request timed out after ${timeoutMs}ms`, err);
        }

        throw new NetworkError(
          this.provider,
          (err as Error)?.message || 'Failed to connect to gateway endpoint',
          err
        );
      }
    }

    throw new NetworkError(this.provider, 'Max retries exhausted during gateway request');
  }
}
