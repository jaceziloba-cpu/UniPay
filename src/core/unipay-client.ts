import {
  PaymentGatewayAdapter,
  CreatePaymentInput,
  PaymentInitializationResult,
  PaymentVerificationResult,
  GatewayProvider,
} from '../types/index.js';
import {
  FallbackExhaustedError,
  GatewayFailureDetail,
  UniPayError,
} from '../errors/unipay-error.js';

export interface FallbackEvent {
  primaryProvider: GatewayProvider;
  fallbackProvider: GatewayProvider;
  error: Error;
  attemptNumber: number;
  input: CreatePaymentInput;
}

export interface UniPayClientOptions {
  /** Liste ordonnée des adaptateurs (la priorité décroît de l'index 0 au dernier) */
  gateways: PaymentGatewayAdapter[];
  /** Stratégie de basculement automatique */
  enableFallback?: boolean;
  /** Hook d'observabilité lors d'un basculement automatique */
  onFallback?: (event: FallbackEvent) => void | Promise<void>;
  /** Hook de log / télémétrie pour les erreurs */
  onError?: (provider: GatewayProvider, error: Error) => void | Promise<void>;
}

export class UniPayClient {
  private readonly gatewayRegistry: Map<string, PaymentGatewayAdapter> = new Map();
  private readonly gatewayList: PaymentGatewayAdapter[] = [];
  private readonly enableFallback: boolean;
  private readonly onFallback?: (event: FallbackEvent) => void | Promise<void>;
  private readonly onError?: (provider: GatewayProvider, error: Error) => void | Promise<void>;

  constructor(options: UniPayClientOptions) {
    if (!options.gateways || options.gateways.length === 0) {
      throw new UniPayError(
        'UniPayClient requires at least one payment gateway adapter configured.',
        'CONFIGURATION_ERROR'
      );
    }

    this.enableFallback = options.enableFallback ?? true;
    this.onFallback = options.onFallback;
    this.onError = options.onError;

    for (const gw of options.gateways) {
      this.registerGateway(gw);
    }
  }

  /**
   * Enregistre un nouvel adaptateur de passerelle
   */
  public registerGateway(gateway: PaymentGatewayAdapter): this {
    this.gatewayRegistry.set(gateway.provider.toLowerCase(), gateway);
    if (!this.gatewayList.some((g) => g.provider === gateway.provider)) {
      this.gatewayList.push(gateway);
    }
    return this;
  }

  /**
   * Récupère un adaptateur par son nom
   */
  public gateway(provider: GatewayProvider): PaymentGatewayAdapter {
    const adapter = this.gatewayRegistry.get(provider.toLowerCase());
    if (!adapter) {
      throw new UniPayError(
        `Payment gateway adapter '${provider}' is not registered in UniPayClient.`,
        'GATEWAY_NOT_FOUND'
      );
    }
    return adapter;
  }

  /**
   * Retourne la liste de tous les adaptateurs enregistrés
   */
  public getAllGateways(): PaymentGatewayAdapter[] {
    return [...this.gatewayList];
  }

  /**
   * Initialise un paiement avec basculement automatique (failover) transparent
   * vers la passerelle suivante en cas d'indisponibilité ou d'erreur
   */
  public async createPayment(
    input: CreatePaymentInput,
    preferredProvider?: GatewayProvider
  ): Promise<PaymentInitializationResult> {
    const candidates = this.resolveEligibleGateways(input, preferredProvider);

    if (candidates.length === 0) {
      throw new UniPayError(
        `No payment gateway available supporting currency '${input.currency}'` +
          (input.customer.country ? ` and country '${input.customer.country}'` : '') +
          '.',
        'NO_ELIGIBLE_GATEWAY'
      );
    }

    const failures: GatewayFailureDetail[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const currentGateway = candidates[i];
      const isLastCandidate = i === candidates.length - 1;

      try {
        const result = await currentGateway.createPayment(input);
        return result;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        failures.push({
          provider: currentGateway.provider,
          error,
          attemptedAt: new Date(),
        });

        if (this.onError) {
          try {
            await this.onError(currentGateway.provider, error);
          } catch {
            // Ignorer les erreurs du logger pour ne pas casser le flux
          }
        }

        // Si le fallback est désactivé ou qu'il s'agit de la dernière passerelle
        if (!this.enableFallback || isLastCandidate) {
          if (candidates.length === 1 || !this.enableFallback) {
            throw error;
          }
          break;
        }

        // Déclencher le basculement vers le candidat suivant
        const nextGateway = candidates[i + 1];
        if (this.onFallback) {
          try {
            await this.onFallback({
              primaryProvider: currentGateway.provider,
              fallbackProvider: nextGateway.provider,
              error,
              attemptNumber: i + 1,
              input,
            });
          } catch {
            // Silence telemetry error
          }
        }
      }
    }

    throw new FallbackExhaustedError('All eligible payment gateways failed during payment initialization.', failures);
  }

  /**
   * Vérifie le statut d'un paiement en interrogeant la passerelle appropriée
   */
  public async verifyPayment(
    transactionId: string,
    provider?: GatewayProvider
  ): Promise<PaymentVerificationResult> {
    if (provider) {
      const adapter = this.gateway(provider);
      return adapter.verifyPayment(transactionId);
    }

    // Si le provider n'est pas spécifié, essayer les passerelles enregistrées
    const failures: string[] = [];
    for (const adapter of this.gatewayList) {
      try {
        return await adapter.verifyPayment(transactionId);
      } catch (err) {
        failures.push(`${adapter.provider}: ${(err as Error).message}`);
      }
    }

    throw new UniPayError(
      `Could not verify transaction ${transactionId} with any registered gateway. Details: [${failures.join(' | ')}]`,
      'VERIFICATION_FAILED'
    );
  }

  /**
   * Sélectionne et ordonne les passerelles compatibles avec les critères de la transaction
   */
  private resolveEligibleGateways(
    input: CreatePaymentInput,
    preferredProvider?: GatewayProvider
  ): PaymentGatewayAdapter[] {
    let list = [...this.gatewayList];

    // Si un fournisseur préféré est demandé, on le place en tête de liste
    if (preferredProvider) {
      const preferred = this.gatewayRegistry.get(preferredProvider.toLowerCase());
      if (preferred) {
        list = [preferred, ...list.filter((g) => g.provider.toLowerCase() !== preferredProvider.toLowerCase())];
      }
    }

    // Filtrer par compatibilité de devise et pays si spécifié
    return list.filter((gw) => {
      const caps = gw.capabilities;
      const currencyMatch = caps.supportedCurrencies.includes(input.currency);
      const countryMatch =
        !input.customer.country ||
        caps.supportedCountries.length === 0 ||
        caps.supportedCountries.includes(input.customer.country);

      return currencyMatch && countryMatch;
    });
  }
}
