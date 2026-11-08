import { NormalizedWebhookEvent } from '../types/webhook.js';

// ─────────────────────────────────────────────────────────────────────────────
// Adaptateurs génériques par Duck Typing
// Compatibles avec Firebase, Supabase, MongoDB, Prisma, PostgreSQL, etc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface générique représentant un document unique dans une base de données.
 * Compatible avec Firebase Admin, Firestore Web SDK, et tout ORM/client custom.
 */
export interface DocumentStoreLike {
  set(data: Record<string, unknown>, options?: { merge: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  get(): Promise<{ exists: boolean; data(): unknown }>;
}

/**
 * Interface générique représentant une collection ou table.
 */
export interface CollectionStoreLike {
  doc(documentPath?: string): DocumentStoreLike;
}

/**
 * Interface générique pour n'importe quel store de données :
 * Firebase Firestore, Supabase, MongoDB, Prisma, etc.
 *
 * @example Firebase Admin
 * const store = getFirestore(); // Compatible nativement
 *
 * @example Supabase (adaptateur simple)
 * const store = createSupabaseStore(supabase, 'subscriptions');
 *
 * @example MongoDB (adaptateur simple)
 * const store = createMongoStore(db, 'subscriptions');
 */
export interface DataStoreLike {
  collection(collectionPath: string): CollectionStoreLike;
  doc(documentPath: string): DocumentStoreLike;
}

export interface SubscriptionHandlerOptions {
  /**
   * Modèle de chemin du document.
   * Défaut : 'subscriptions/{subscriptionId}'
   * Variables disponibles : {userId}, {subscriptionId}
   */
  documentPathPattern?: string;
  /** Durée de l'abonnement en jours si non précisée dans les métadonnées (défaut: 30) */
  defaultDurationDays?: number;
  /** Transformateur personnalisé pour construire le payload à sauvegarder */
  customDataMapper?: (
    event: NormalizedWebhookEvent,
    calculatedPeriod: { start: Date; end: Date }
  ) => Record<string, unknown>;
}

export interface SubscriptionRecord {
  subscriptionId: string;
  userId?: string;
  planId?: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'PENDING';
  provider: string;
  providerTransactionId: string;
  reference: string;
  amount: number;
  currency: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Crée un gestionnaire d'abonnement agnostique qui se connecte à n'importe
 * quelle base de données : Firebase, Supabase, MongoDB, Prisma, PostgreSQL…
 *
 * @param store - Instance de votre base de données (Firebase, Supabase wrapper, etc.)
 * @param options - Options de configuration du gestionnaire
 *
 * @example Avec Firebase
 * const handler = createSubscriptionHandler(getFirestore(), { documentPathPattern: 'users/{userId}/subscriptions/{subscriptionId}' });
 *
 * @example Avec Supabase
 * const handler = createSubscriptionHandler(createSupabaseStore(supabase), { ... });
 */
export function createSubscriptionHandler(
  store: DataStoreLike,
  options: SubscriptionHandlerOptions = {}
) {
  const {
    documentPathPattern = 'subscriptions/{subscriptionId}',
    defaultDurationDays = 30,
    customDataMapper,
  } = options;

  return async function handleSubscriptionSync(
    event: NormalizedWebhookEvent
  ): Promise<{ path: string; status: SubscriptionRecord['status'] }> {
    const metadata = event.metadata || {};
    const userId =
      (metadata.userId as string) ||
      (event.customer?.email ? event.customer.email : 'anonymous');
    const subscriptionId =
      (metadata.subscriptionId as string) ||
      (metadata.planId ? `${userId}_${metadata.planId}` : event.reference);

    // Calcul de la période de validité
    const durationDays = Number(metadata.durationDays || defaultDurationDays);
    const startDate = event.timestamp || new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let status: SubscriptionRecord['status'] = 'PENDING';
    if (event.status === 'SUCCESSFUL') status = 'ACTIVE';
    else if (event.status === 'FAILED') status = 'PAST_DUE';
    else if (event.status === 'CANCELLED') status = 'CANCELLED';

    const resolvedPath = documentPathPattern
      .replace('{userId}', userId)
      .replace('{subscriptionId}', subscriptionId);

    const docRef = store.doc(resolvedPath);

    const baseData: SubscriptionRecord = {
      subscriptionId,
      userId,
      planId: metadata.planId as string | undefined,
      status,
      provider: event.provider,
      providerTransactionId: event.providerTransactionId,
      reference: event.reference,
      amount: event.amount,
      currency: event.currency,
      currentPeriodStart: startDate.toISOString(),
      currentPeriodEnd: endDate.toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: event.metadata,
    };

    const finalPayload = customDataMapper
      ? customDataMapper(event, { start: startDate, end: endDate })
      : baseData;

    await docRef.set(finalPayload as Record<string, unknown>, { merge: true });

    return { path: resolvedPath, status };
  };
}

/**
 * Alias de rétrocompatibilité — pointe vers createSubscriptionHandler
 * @deprecated Utilisez createSubscriptionHandler à la place
 */
export const createFirebaseSubscriptionHandler = createSubscriptionHandler;

/** @deprecated Utilisez DataStoreLike à la place */
export type FirestoreLike = DataStoreLike;
/** @deprecated Utilisez DocumentStoreLike à la place */
export type FirestoreDocumentReferenceLike = DocumentStoreLike;
/** @deprecated Utilisez CollectionStoreLike à la place */
export type FirestoreCollectionReferenceLike = CollectionStoreLike;
/** @deprecated Utilisez SubscriptionHandlerOptions à la place */
export type FirebaseSubscriptionOptions = SubscriptionHandlerOptions;
