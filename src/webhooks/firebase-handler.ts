import { NormalizedWebhookEvent } from '../types/webhook.js';

/**
 * Interface découplée (Duck Typing) pour accepter n'importe quelle instance Firestore
 * (firebase-admin, @google-cloud/firestore, ou Firebase Web SDK) sans forcer l'installation de dépendance
 */
export interface FirestoreDocumentReferenceLike {
  set(data: Record<string, unknown>, options?: { merge: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  get(): Promise<{ exists: boolean; data(): unknown }>;
}

export interface FirestoreCollectionReferenceLike {
  doc(documentPath?: string): FirestoreDocumentReferenceLike;
}

export interface FirestoreLike {
  collection(collectionPath: string): FirestoreCollectionReferenceLike;
  doc(documentPath: string): FirestoreDocumentReferenceLike;
}

export interface FirebaseSubscriptionOptions {
  /**
   * Modèle de chemin de collection ou de document.
   * Valeurs par défaut : 'subscriptions/{subscriptionId}'
   * Vous pouvez utiliser des variables comme '{userId}' ou '{subscriptionId}'
   */
  documentPathPattern?: string;
  /** Durée d'abonnement par défaut en jours si non spécifiée dans les métadonnées (défaut: 30) */
  defaultDurationDays?: number;
  /** Nom du champ stockant le statut d'abonnement (défaut: 'status') */
  statusFieldName?: string;
  /** Fonction personnalisée pour transformer l'événement en données Firestore */
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
 * Crée un gestionnaire d'abonnement Firebase prêt à l'emploi pour le dispatcher de Webhook
 */
export function createFirebaseSubscriptionHandler(
  firestore: FirestoreLike,
  options: FirebaseSubscriptionOptions = {}
) {
  const {
    documentPathPattern = 'subscriptions/{subscriptionId}',
    defaultDurationDays = 30,
    customDataMapper,
  } = options;

  return async function handleFirebaseSubscriptionSync(
    event: NormalizedWebhookEvent
  ): Promise<{ path: string; status: string }> {
    const metadata = event.metadata || {};
    const userId = (metadata.userId as string) || (event.customer?.email ? event.customer.email : 'anonymous');
    const subscriptionId =
      (metadata.subscriptionId as string) ||
      (metadata.planId ? `${userId}_${metadata.planId}` : event.reference);

    // Calcul de la période de validité
    const durationDays = Number(metadata.durationDays || defaultDurationDays);
    const startDate = event.timestamp || new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let status: SubscriptionRecord['status'] = 'PENDING';
    if (event.status === 'SUCCESSFUL') {
      status = 'ACTIVE';
    } else if (event.status === 'FAILED') {
      status = 'PAST_DUE';
    } else if (event.status === 'CANCELLED') {
      status = 'CANCELLED';
    }

    // Résolution du chemin du document Firestore
    const resolvedPath = documentPathPattern
      .replace('{userId}', userId)
      .replace('{subscriptionId}', subscriptionId);

    const docRef = firestore.doc(resolvedPath);

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

    return {
      path: resolvedPath,
      status,
    };
  };
}
