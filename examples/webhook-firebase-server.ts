import * as http from 'node:http';
import {
  WebhookDispatcher,
  FedaPayAdapter,
  CinetPayAdapter,
  createFirebaseSubscriptionHandler,
  FirestoreLike,
} from '../src/index.js';

// Simulation d'une instance Firestore (compatible firebase-admin ou @google-cloud/firestore)
const mockFirestoreDatabase = new Map<string, unknown>();

const mockFirestore: FirestoreLike = {
  doc: (path: string) => ({
    get: async () => ({
      exists: mockFirestoreDatabase.has(path),
      data: () => mockFirestoreDatabase.get(path),
    }),
    set: async (data: Record<string, unknown>, options?: { merge: boolean }) => {
      const existing = (mockFirestoreDatabase.get(path) as Record<string, unknown>) || {};
      const merged = options?.merge ? { ...existing, ...data } : data;
      mockFirestoreDatabase.set(path, merged);
      console.log(`[Firestore SET] Document '${path}' mis à jour avec succès :`, merged);
      return merged;
    },
    update: async (data: Record<string, unknown>) => {
      const existing = (mockFirestoreDatabase.get(path) as Record<string, unknown>) || {};
      const merged = { ...existing, ...data };
      mockFirestoreDatabase.set(path, merged);
      console.log(`[Firestore UPDATE] Document '${path}' mis à jour :`, merged);
      return merged;
    },
  }),
  collection: (collectionPath: string) => ({
    doc: (docId?: string) => mockFirestore.doc(`${collectionPath}/${docId || 'auto_id'}`),
  }),
};

// 1. Initialiser les passerelles et le dispatcher de webhooks
const fedapay = new FedaPayAdapter({
  apiKey: 'sk_live_dummy',
  webhookSecret: 'whsec_fedapay_test',
});

const cinetpay = new CinetPayAdapter({
  apiKey: 'cinetpay_key_dummy',
  siteId: 'site_dummy',
  secretKey: 'whsec_cinetpay_test',
});

const dispatcher = new WebhookDispatcher([fedapay, cinetpay]);

// 2. Créer le gestionnaire d'abonnement Firebase
const firebaseSync = createFirebaseSubscriptionHandler(mockFirestore, {
  documentPathPattern: 'users/{userId}/subscriptions/{subscriptionId}',
  defaultDurationDays: 30,
});

// 3. Connecter le gestionnaire aux événements
dispatcher.on('payment.success', async (event) => {
  console.log(`✅ Paiement validé pour ${event.reference} via ${event.provider}`);
  const syncResult = await firebaseSync(event);
  console.log(`Synchronisation Firebase achevée pour : ${syncResult.path} (Statut: ${syncResult.status})`);
});

dispatcher.on('payment.failed', async (event) => {
  console.warn(`❌ Paiement échoué pour ${event.reference} via ${event.provider}`);
  await firebaseSync(event);
});

// 4. Serveur HTTP Agnostique (Express, Fastify, Cloud Function ou Node HTTP natif)
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/webhooks')) {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        const payload = JSON.parse(rawBody);

        // Traitement automatique, normalisation et vérification de signature
        const normalized = await dispatcher.handleWebhook(payload, {
          rawBody,
          headers: req.headers as Record<string, string | string[] | undefined>,
          verifySignature: false, // Passer à true en production avec les vraies clés
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', eventId: normalized.eventId }));
      } catch (err: unknown) {
        console.error('Erreur traitement webhook :', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Serveur Webhook UniPay en écoute sur http://localhost:${PORT}/webhooks`);
});
