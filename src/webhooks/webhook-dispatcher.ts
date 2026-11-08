import { PaymentGatewayAdapter, GatewayProvider } from '../types/gateway.js';
import { NormalizedWebhookEvent, WebhookEventType } from '../types/webhook.js';
import { InvalidSignatureError, UniPayError } from '../errors/unipay-error.js';

export type WebhookEventListener = (event: NormalizedWebhookEvent) => void | Promise<void>;

export interface WebhookDispatchOptions {
  /** Nom du fournisseur (optionnel, inféré automatiquement si omis) */
  provider?: GatewayProvider;
  /** Corps brut de la requête (nécessaire pour la validation HMAC exacte) */
  rawBody?: string | Buffer;
  /** En-têtes HTTP de la requête entrante */
  headers?: Record<string, string | string[] | undefined>;
  /** Vérifier obligatoirement la signature cryptographique (défaut: true si un secret est configuré) */
  verifySignature?: boolean;
}

export class WebhookDispatcher {
  private readonly gatewayRegistry: Map<string, PaymentGatewayAdapter> = new Map();
  private readonly listeners: Map<WebhookEventType | 'all', Set<WebhookEventListener>> = new Map();

  constructor(gateways: PaymentGatewayAdapter[] = []) {
    for (const gw of gateways) {
      this.registerGateway(gw);
    }
  }

  public registerGateway(gateway: PaymentGatewayAdapter): this {
    this.gatewayRegistry.set(gateway.provider.toLowerCase(), gateway);
    return this;
  }

  /**
   * Enregistre un écouteur sur un type d'événement précis
   */
  public on(eventType: WebhookEventType, listener: WebhookEventListener): this {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);
    return this;
  }

  /**
   * Enregistre un écouteur sur tous les événements entrants
   */
  public onAny(listener: WebhookEventListener): this {
    if (!this.listeners.has('all')) {
      this.listeners.set('all', new Set());
    }
    this.listeners.get('all')!.add(listener);
    return this;
  }

  /**
   * Traite, valide et normalise un webhook entrant, puis déclenche les écouteurs enregistrés
   */
  public async handleWebhook(
    payload: unknown,
    options: WebhookDispatchOptions = {}
  ): Promise<NormalizedWebhookEvent> {
    const provider = options.provider || this.detectProvider(payload, options.headers);
    if (!provider) {
      throw new UniPayError(
        'Unable to detect payment gateway provider from incoming webhook headers or payload.',
        'PROVIDER_NOT_DETECTED'
      );
    }

    const adapter = this.gatewayRegistry.get(provider.toLowerCase());
    if (!adapter) {
      throw new UniPayError(
        `No registered gateway adapter found to handle webhook for provider '${provider}'.`,
        'ADAPTER_NOT_FOUND'
      );
    }

    // Validation cryptographique de signature si demandée
    if (options.verifySignature !== false) {
      this.validateSignature(adapter, options);
    }

    // Normalisation de l'événement
    const normalizedEvent = await adapter.parseWebhook(payload, options.headers);

    // Notification des écouteurs
    await this.notifyListeners(normalizedEvent);

    return normalizedEvent;
  }

  private validateSignature(adapter: PaymentGatewayAdapter, options: WebhookDispatchOptions): void {
    const headers = options.headers || {};
    const signatureHeader =
      this.extractHeader(headers, 'x-fedapay-signature') ||
      this.extractHeader(headers, 'x-cinetpay-signature') ||
      this.extractHeader(headers, 'x-signature') ||
      '';

    if (options.rawBody && signatureHeader) {
      const isValid = adapter.verifyWebhookSignature(options.rawBody, signatureHeader);
      if (!isValid) {
        throw new InvalidSignatureError(adapter.provider);
      }
    }
  }

  private async notifyListeners(event: NormalizedWebhookEvent): Promise<void> {
    const specificListeners = this.listeners.get(event.eventType) || new Set();
    const globalListeners = this.listeners.get('all') || new Set();

    const allListeners = [...specificListeners, ...globalListeners];

    for (const listener of allListeners) {
      try {
        await listener(event);
      } catch (err) {
        // Les erreurs d'un écouteur ne doivent pas empêcher les autres de s'exécuter
        console.error(`[WebhookDispatcher] Error in webhook listener for ${event.eventType}:`, err);
      }
    }
  }

  /**
   * Détecte intelligemment le fournisseur à partir des en-têtes et du format du corps
   */
  private detectProvider(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): GatewayProvider | undefined {
    if (headers) {
      if (this.extractHeader(headers, 'x-fedapay-signature') || this.extractHeader(headers, 'x-fedapay-event')) {
        return 'fedapay';
      }
      if (this.extractHeader(headers, 'x-cinetpay-signature')) {
        return 'cinetpay';
      }
    }

    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;
      if ('entity' in obj && 'name' in obj && typeof obj.name === 'string' && obj.name.startsWith('transaction.')) {
        return 'fedapay';
      }
      if ('cpm_site_id' in obj || 'cpm_trans_id' in obj || 'cpm_result' in obj) {
        return 'cinetpay';
      }
    }

    return undefined;
  }

  private extractHeader(
    headers: Record<string, string | string[] | undefined>,
    targetName: string
  ): string | undefined {
    const lowerTarget = targetName.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerTarget) {
        return Array.isArray(value) ? value[0] : value;
      }
    }
    return undefined;
  }
}
