import {
  CreatePaymentInput,
  PaymentInitializationResult,
  PaymentVerificationResult,
  Currency,
  AfricanCountryCode,
} from './payment.js';
import { NormalizedWebhookEvent } from './webhook.js';

export type GatewayProvider = 'fedapay' | 'cinetpay' | 'wave' | 'orangemoney' | (string & {});

export interface GatewayCapabilities {
  supportedCurrencies: readonly Currency[];
  supportedCountries: readonly AfricanCountryCode[];
  supportsWebhooks: boolean;
  supportsRefunds: boolean;
}

export interface BaseGatewayConfig {
  /** Mode test / sandbox ou production */
  isSandbox?: boolean;
  /** Timeout des requêtes HTTP en millisecondes (défaut: 15000ms) */
  timeoutMs?: number;
  /** Nombre maximal de tentatives en cas d'erreur réseau transitoire */
  maxRetries?: number;
}

export interface FedaPayConfig extends BaseGatewayConfig {
  provider: 'fedapay';
  /** Clé API secrète (sk_live_... ou sk_sandbox_...) */
  apiKey: string;
  /** Secret de webhook pour la validation HMAC (optionnel) */
  webhookSecret?: string;
  /** Environnement sandbox forcé si différent du format de clé */
  environment?: 'sandbox' | 'live';
}

export interface CinetPayConfig extends BaseGatewayConfig {
  provider: 'cinetpay';
  /** Clé API CinetPay */
  apiKey: string;
  /** Identifiant du site CinetPay (Site ID) */
  siteId: string;
  /** Clé secrète pour valider les webhooks / notifications */
  secretKey?: string;
}

export interface WaveConfig extends BaseGatewayConfig {
  provider: 'wave';
  apiToken: string;
  webhookSecret?: string;
}

export type GatewayConfig = FedaPayConfig | CinetPayConfig | WaveConfig | (BaseGatewayConfig & { provider: string; [key: string]: unknown });

export interface PaymentGatewayAdapter {
  /** Identifiant unique du fournisseur */
  readonly provider: GatewayProvider;

  /** Capacités et devises gérées */
  readonly capabilities: GatewayCapabilities;

  /** Initialise un paiement et retourne l'URL de paiement standardisée */
  createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult>;

  /** Vérifie l'état d'un paiement via la référence marchand ou l'ID fournisseur */
  verifyPayment(transactionId: string): Promise<PaymentVerificationResult>;

  /** Parse et normalise un webhook brut reçu de cette passerelle */
  parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): Promise<NormalizedWebhookEvent>;

  /** Valide la signature cryptographique du webhook */
  verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureHeader: string,
    secret?: string
  ): boolean;
}
