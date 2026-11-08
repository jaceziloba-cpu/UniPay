# 🌍 UniPay Africa

> SDK TypeScript universel, modulaire et ultra-résilient pour unifier les passerelles de paiement africaines (**FedaPay, CinetPay, PayDunya, Kkiapay**) avec **basculement automatique** et **intégration agnostique avec toute base de données**.

[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20runtime-brightgreen.svg)](#résilience)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](#architecture)
[![Tests](https://img.shields.io/badge/tests-100%25%20passing-success.svg)](#tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 Pourquoi UniPay ?

L'intégration des paiements en Afrique subsaharienne (zone UEMOA, CEMAC, etc.) confronte les développeurs et startups à des défis majeurs :

1. **Fragmentation extrême des passerelles** : FedaPay, CinetPay, PayDunya, Kkiapay, Wave, Orange Money possèdent chacun leur propre format de payload, protocoles de signature et statuts de transaction.
2. **Disponibilité variable et pannes API** : Une coupure réseau ou une saturation chez un opérateur entraîne immédiatement une perte de conversions pour le marchand.
3. **Complexité des webhooks** : Chaque passerelle notifie différemment (corps JSON hétérogènes, formats de signature variables).
4. **Mise à jour des abonnements** : Synchroniser l'accès utilisateur après un paiement nécessite du code répétitif avec n'importe quelle base de données.

**UniPay résout ces problèmes grâce à :**
- Une **interface unifiée** (`createPayment`, `verifyPayment`, `parseWebhook`).
- Un **basculement automatique intelligent** : si l'API primaire échoue (5xx/timeout), UniPay bascule de façon transparente sur la passerelle de secours.
- Un **moteur de webhooks agnostique** sécurisé par HMAC-SHA256.
- Un **gestionnaire d'abonnements universel** compatible avec toute base de données : Firebase, Supabase, MongoDB, Prisma, PostgreSQL, etc.
- **Zéro dépendance d'exécution** : uniquement l'API native `fetch` et `node:crypto`.

---

## 🏗️ Architecture Globale

```mermaid
flowchart TD
    App["Application Marchande (Node.js / Next.js / Nest / Edge)"]
    Client["UniPayClient (Orchestrateur & Fallback)"]

    App -->|createPayment()| Client

    subgraph "Mécanisme de Basculement Automatique"
        GW1["Passerelle Primaire\n(ex: FedaPay)"]
        GW2["Passerelle Secours 1\n(ex: CinetPay)"]
        GW3["Passerelle Secours 2\n(ex: PayDunya / Kkiapay)"]

        Client -->|1. Essai initial| GW1
        GW1 -.->|Échec 5xx / Timeout| Client
        Client -->|2. Basculement auto| GW2
        GW2 -.->|Si échec| Client
        Client -->|3. Secours| GW3
    end

    subgraph "Webhooks & Synchronisation Base de Données"
        WH["WebhookDispatcher"]
        Detect["Détection auto & Vérification HMAC"]
        Normalize["NormalizedWebhookEvent (format universel)"]
        DB["Gestionnaire d'abonnements agnostique"]

        WH --> Detect --> Normalize --> DB
        DB -->|Mise à jour état| AnyDB[("Firebase / Supabase\nMongoDB / Prisma / …")]
    end
```

---

## 📦 Structure du Projet

```
UniPay/
├── src/
│   ├── index.ts                          # Point d'entrée de la librairie
│   ├── types/
│   │   ├── payment.ts                    # Modèles standardisés (Input, Status, Currency)
│   │   ├── gateway.ts                    # Contrat d'interface des passerelles
│   │   ├── webhook.ts                    # Modèle normalisé des événements entrants
│   │   └── index.ts
│   ├── errors/
│   │   └── unipay-error.ts               # Hiérarchie typée des exceptions
│   ├── core/
│   │   ├── base-adapter.ts               # Moteur HTTP unifié : retries, timeout, erreurs
│   │   └── unipay-client.ts              # Orchestrateur & moteur de basculement automatique
│   ├── adapters/
│   │   ├── fedapay/                      # FedaPay (Bénin, Togo, CI, Sénégal…)
│   │   ├── cinetpay/                     # CinetPay (CI, Sénégal, Cameroun, ML…)
│   │   ├── paydunya/                     # PayDunya (Sénégal, CI, Bénin, Togo…)
│   │   └── kkiapay/                      # Kkiapay (Bénin, CI, Sénégal, Cameroun…)
│   ├── webhooks/
│   │   ├── webhook-dispatcher.ts         # Répartiteur & validation HMAC des webhooks
│   │   └── subscription-handler.ts       # Gestionnaire d'abonnements universel
│   └── utils/
│       └── crypto.ts                     # HMAC & comparaisons à temps constant
├── examples/
│   ├── basic-checkout.ts                 # Exemple d'encaissement standard
│   ├── fallback-resilience.ts            # Démonstration du basculement automatique
│   └── webhook-firebase-server.ts        # Exemple de serveur webhook
└── test/
    └── unipay.test.ts                    # Suite de tests unitaires (Node Test Runner)
```

---

## 🚀 Installation

```bash
npm install unipay-africa
# ou
pnpm add unipay-africa
# ou
yarn add unipay-africa
```

> **Prérequis** : Node.js ≥ 18.0.0 (compatible Deno, Bun et Cloudflare Workers).

---

## 💡 Guide d'Utilisation

### 1. Avec une seule passerelle (cas le plus simple)

```typescript
import { UniPayClient, KkiapayAdapter } from 'unipay-africa';

const unipay = new UniPayClient({
  gateways: [
    new KkiapayAdapter({
      publicKey: process.env.KKIAPAY_PUBLIC_KEY!,
      privateKey: process.env.KKIAPAY_PRIVATE_KEY!,
    }),
  ],
});
```

---

### 2. Avec plusieurs passerelles et basculement automatique

```typescript
import { UniPayClient, FedaPayAdapter, CinetPayAdapter, PayDunyaAdapter, KkiapayAdapter } from 'unipay-africa';

const unipay = new UniPayClient({
  gateways: [
    new FedaPayAdapter({ apiKey: process.env.FEDAPAY_SECRET_KEY! }),
    new CinetPayAdapter({ apiKey: process.env.CINETPAY_API_KEY!, siteId: process.env.CINETPAY_SITE_ID! }),
    new PayDunyaAdapter({ masterKey: process.env.PAYDUNYA_MASTER_KEY!, publicKey: process.env.PAYDUNYA_PUBLIC_KEY!, privateKey: process.env.PAYDUNYA_PRIVATE_KEY!, token: process.env.PAYDUNYA_TOKEN! }),
    new KkiapayAdapter({ publicKey: process.env.KKIAPAY_PUBLIC_KEY!, privateKey: process.env.KKIAPAY_PRIVATE_KEY! }),
  ],
  enableFallback: true,
  onFallback: (event) => {
    console.warn(`[BASCULEMENT] ${event.primaryProvider} indisponible → ${event.fallbackProvider}`);
  },
});
```

---

### 3. Création d'une transaction

```typescript
const payment = await unipay.createPayment({
  reference: `CMD_${Date.now()}`,
  amount: 5000,
  currency: 'XOF',
  description: 'Abonnement mensuel Pro',
  returnUrl: 'https://mon-app.com/paiement/retour',
  callbackUrl: 'https://api.mon-app.com/webhooks/paiement',
  customer: {
    firstName: 'Amadou',
    lastName: 'Kouassi',
    email: 'amadou@example.com',
    phoneNumber: '+2250700000000',
    country: 'CI',
  },
  metadata: {
    userId: 'usr_abc123',
    planId: 'pro_monthly',
  },
});

console.log(`Passerelle active : ${payment.provider}`);
console.log(`Lien de paiement : ${payment.paymentUrl}`);
```

---

### 4. Webhooks & Synchronisation avec votre base de données

Le gestionnaire `createSubscriptionHandler` est **compatible avec toute base de données** :

```typescript
import { WebhookDispatcher, createSubscriptionHandler } from 'unipay-africa';

const dispatcher = new WebhookDispatcher(unipay.getAllGateways());

// ─── Avec Firebase ───────────────────────────────────────────────
import { getFirestore } from 'firebase-admin/firestore';
const sync = createSubscriptionHandler(getFirestore(), { documentPathPattern: 'users/{userId}/subscriptions/{subscriptionId}' });

// ─── Avec Supabase ───────────────────────────────────────────────
// const sync = createSubscriptionHandler(createSupabaseStore(supabase), { ... });

// ─── Avec MongoDB / Prisma ───────────────────────────────────────
// const sync = createSubscriptionHandler(createMongoStore(db), { ... });

// Connexion des événements (identique quelle que soit la base de données)
dispatcher.on('payment.success', async (event) => {
  await sync(event); // Statut → ACTIVE
});

dispatcher.on('payment.failed', async (event) => {
  await sync(event); // Statut → PAST_DUE
});

// Endpoint HTTP universel (Express, Fastify, Nest, Cloud Functions…)
app.post('/webhooks/paiement', express.raw({ type: '*/*' }), async (req, res) => {
  const event = await dispatcher.handleWebhook(JSON.parse(req.body), {
    rawBody: req.body,
    headers: req.headers,
    verifySignature: true,
  });
  res.json({ received: true, eventId: event.eventId });
});
```

---

## 🌍 Couverture des Passerelles

| Passerelle | Pays couverts | Devises | Remboursements |
|---|---|---|---|
| **FedaPay** | Bénin, CI, Togo, Sénégal, Mali, BF, Niger | XOF | ✅ |
| **CinetPay** | CI, Sénégal, Cameroun, BF, Mali, Congo, Guinée | XOF, XAF, USD | ❌ |
| **PayDunya** | Sénégal, CI, Bénin, Togo, Mali, BF, Guinée, Niger | XOF | ❌ |
| **Kkiapay** | Bénin, CI, Sénégal, Togo, Cameroun, BF, Mali | XOF, XAF | ✅ |

---

## 🛡️ Résilience

| Fonctionnalité | Description |
| :--- | :--- |
| **Basculement automatique** | Si une passerelle est indisponible, la suivante prend le relais de façon transparente. |
| **Retries exponentiels** | Tentatives automatiques avec backoff et jitter sur erreurs réseau transitoires (429, 502, 503). |
| **Timeout strict** | Chaque appel est limité dans le temps via `AbortController` pour éviter tout blocage. |
| **Vérification HMAC** | Signatures des webhooks validées à temps constant via `crypto.timingSafeEqual`. |
| **Zéro dépendance** | Aucun package tiers requis — empreinte minimale, risque zéro sur la chaîne d'approvisionnement. |

---

## 🧪 Tests

```bash
npm run build  # Compiler
npm test       # Lancer les tests
```

---

## 📄 Licence

Licence **MIT** — libre d'utilisation pour tout projet commercial ou open-source.
