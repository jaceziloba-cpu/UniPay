import { Currency, CustomerInfo, TransactionStatus } from './payment.js';
import { GatewayProvider } from './gateway.js';

export type WebhookEventType =
  | 'payment.success'
  | 'payment.failed'
  | 'payment.pending'
  | 'payment.cancelled';

export interface NormalizedWebhookEvent {
  /** Identifiant unique de l'événement webhook */
  eventId: string;
  /** Passerelle émettrice */
  provider: GatewayProvider;
  /** Type d'événement standardisé */
  eventType: WebhookEventType;
  /** Statut normalisé de la transaction */
  status: TransactionStatus;
  /** Référence marchand interne de la transaction */
  reference: string;
  /** Identifiant de la transaction chez la passerelle */
  providerTransactionId: string;
  /** Montant payé */
  amount: number;
  /** Devise */
  currency: Currency;
  /** Informations client si disponibles */
  customer?: Partial<CustomerInfo>;
  /** Horodatage de l'événement */
  timestamp: Date;
  /** Métadonnées associées à la transaction */
  metadata?: Record<string, unknown>;
  /** Charge utile brute originale */
  rawPayload: unknown;
}

export interface WebhookVerificationOptions {
  /** Corps brut de la requête HTTP (nécessaire pour la vérification HMAC) */
  rawBody: string | Buffer;
  /** En-têtes HTTP de la requête entrante */
  headers: Record<string, string | string[] | undefined>;
  /** Clé secrète de webhook (si différente de celle configurée dans l'adaptateur) */
  secret?: string;
}
