/**
 * UniPay Africa - SDK TypeScript universel et modulaire pour les passerelles de paiement africaines
 *
 * @packageDocumentation
 */

export * from './types/index.js';
export * from './errors/index.js';
export * from './core/index.js';
export * from './adapters/index.js';
export * from './webhooks/index.js';
export * from './utils/index.js';

// Ré-exportation directe des classes principales pour un import simplifié
export { UniPayClient } from './core/unipay-client.js';
export { FedaPayAdapter } from './adapters/fedapay/fedapay-adapter.js';
export { CinetPayAdapter } from './adapters/cinetpay/cinetpay-adapter.js';
export { PayDunyaAdapter } from './adapters/paydunya/paydunya-adapter.js';
export { KkiapayAdapter } from './adapters/kkiapay/kkiapay-adapter.js';
export { WebhookDispatcher } from './webhooks/webhook-dispatcher.js';
export { createSubscriptionHandler, createFirebaseSubscriptionHandler } from './webhooks/subscription-handler.js';
