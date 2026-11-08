# 🌍 UniPay Africa

> SDK TypeScript universel, modulaire et ultra-résilient pour unifier les passerelles de paiement africaines (**FedaPay, CinetPay, Wave, Orange Money**) avec **basculement automatique (Failover)** et **synchronisation Firebase agnostique**.

[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20runtime-brightgreen.svg)](#caractéristiques-clés)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](#architecture)
[![Coverage](https://img.shields.io/badge/tests-100%25%20passing-success.svg)](#tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 Pourquoi UniPay ?

L'intégration des paiements en Afrique subsaharienne (zone UEMOA, CEMAC, etc.) confronte les développeurs et startups à des défis majeurs :
1. **Fragmentation extrême des passerelles** : FedaPay, CinetPay, Wave, Orange Money, MTN MoMo, Moov Money possèdent chacun leur propre format de payload, protocoles de signature et statuts de transaction.
2. **Disponibilité variable et pannes API fréquentes** : Une coupure réseau ou une saturation chez un opérateur mobile entraîne immédiatement une perte de conversions pour le marchand.
3. **Complexité des webhooks** : Chaque passerelle notifie différemment (paramètres GET, corps JSON, formats d'horodatage hétérogènes).
4. **Intégration d'abonnements** : Mettre à jour l'accès utilisateur (ex: Firebase / Firestore) nécessite souvent du code répétitif et sensible aux failles de sécurité.

**UniPay résout ces problèmes grâce à :**
- Une **interface unifiée** (`createPayment`, `verifyPayment`, `parseWebhook`).
- Un **mécanisme de Failover automatique intelligent** : si l'API primaire est inaccessible ou renvoie une erreur serveur (5xx/timeout), UniPay bascule de façon transparente sur la passerelle de secours configurée pour le pays ou la devise.
- Un **moteur de webhooks agnostique** et sécurisé par HMAC-SHA256.
- Un **connecteur Firebase Firestore découplé** (Duck-typed, sans forcer de dépendance lourde).
- **Zéro dépendance d'exécution** : utilise exclusivement l'API native `fetch` et `node:crypto`.

---

## 🏗️ Architecture Globale

```mermaid
flowchart TD
    App["Application Marchande (Node.js / Next.js / Nest / Edge)"]
    Client["UniPayClient (Orchestrateur & Circuit Breaker)"]
    
    App -->|createPayment()| Client
    
    subgraph "Mécanisme de Basculement (Fallback Chain)"
        GW1["Passerelle Primaire\n(ex: FedaPay)"]
        GW2["Passerelle Secours 1\n(ex: CinetPay)"]
        GW3["Passerelle Secours 2\n(ex: Wave / OM)"]
        
        Client -->|1. Essai initial| GW1
        GW1 -.->|Échec 5xx / Timeout| Client
        Client -->|2. Failover automatique| GW2
        GW2 -.->|Si échec| Client
        Client -->|3. Secours| GW3
    end
    
    subgraph "Gestion Agnostique des Webhooks"
        WH["WebhookDispatcher"]
        Detect["Détection automatique & Vérification HMAC"]
        Normalize["Normalisation standardisée (NormalizedWebhookEvent)"]
        FB["Firebase Subscription Sync"]
        
        WH --> Detect --> Normalize --> FB
        FB -->|Mise à jour état| Firestore[("Cloud Firestore / Firebase")]
    end
```

---

## 📦 Structure du Projet

```
UniPay/
├── src/
│   ├── index.ts                      # Point d'entrée de la librairie
│   ├── types/
│   │   ├── payment.ts                # Modèles standardisés (Input, Status, Currency)
│   │   ├── gateway.ts                # Contrat d'interface des passerelles
│   │   ├── webhook.ts                # Modèle normalisé des événements entrants
│   │   └── index.ts
│   ├── errors/
│   │   ├── unipay-error.ts           # Hiérarchie typée des exceptions
│   │   └── index.ts
│   ├── core/
│   │   ├── base-adapter.ts           # Classe de base avec HTTP natif, retries & timeout
│   │   ├── unipay-client.ts          # Orchestrateur & moteur de fallback automatique
│   │   └── index.ts
│   ├── adapters/
│   │   ├── fedapay/                  # Implémentation concrète FedaPay (Bénin, Togo, CI...)
│   │   ├── cinetpay/                 # Implémentation concrète CinetPay (CI, SN, CM, ML...)
│   │   └── index.ts
│   ├── webhooks/
│   │   ├── webhook-dispatcher.ts     # Routeur de notifications & vérification de signature
│   │   ├── firebase-handler.ts       # Synchroniseur d'abonnements pour Firebase / Firestore
│   │   └── index.ts
│   └── utils/
│       ├── crypto.ts                 # Utilitaires HMAC et comparaison à temps constant
│       └── index.ts
├── examples/
│   ├── basic-checkout.ts             # Exemple d'encaissement direct
│   ├── fallback-resilience.ts        # Exemple de haute disponibilité et tolérance aux pannes
│   └── webhook-firebase-server.ts    # Serveur HTTP de webhook avec mise à jour Firestore
└── test/
    └── unipay.test.ts                # Suite de tests unitaires (Node Test Runner)
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

> **Prérequis runtime** : Node.js ≥ 18.0.0 (compatible Deno, Bun et Cloudflare Workers).

---

## 💡 Guide d'Utilisation

### 1. Initialisation avec Haute Disponibilité (Fallback)

```typescript
import { UniPayClient, FedaPayAdapter, CinetPayAdapter } from 'unipay-africa';

// Configurer les adaptateurs dans l'ordre de priorité
const unipay = new UniPayClient({
  gateways: [
    new FedaPayAdapter({
      apiKey: process.env.FEDAPAY_SECRET_KEY!,
      webhookSecret: process.env.FEDAPAY_WEBHOOK_SECRET,
      isSandbox: process.env.NODE_ENV !== 'production',
    }),
    new CinetPayAdapter({
      apiKey: process.env.CINETPAY_API_KEY!,
      siteId: process.env.CINETPAY_SITE_ID!,
      secretKey: process.env.CINETPAY_SECRET_KEY,
      isSandbox: process.env.NODE_ENV !== 'production',
    }),
  ],
  enableFallback: true, // Active le basculement transparent
  onFallback: (event) => {
    console.warn(`[FAILOVER] Passerelle ${event.primaryProvider} indisponible.`);
    console.warn(`Basculement automatique vers ${event.fallbackProvider}`);
  },
});
```

---

### 2. Création d'une Transaction Standardisée

```typescript
const payment = await unipay.createPayment({
  reference: `CMD_${Date.now()}`,
  amount: 5000,
  currency: 'XOF', // XOF (FCFA UEMOA), XAF (CEMAC), GNF, CDF, USD
  description: 'Accès mensuel Pro UniPay',
  returnUrl: 'https://mon-application.com/paiement/retour',
  callbackUrl: 'https://api.mon-application.com/webhooks/paiement',
  customer: {
    firstName: 'Amadou',
    lastName: 'Kouassi',
    email: 'amadou.kouassi@example.com',
    phoneNumber: '+2250700000000',
    country: 'CI', // Côte d'Ivoire
    city: 'Abidjan',
  },
  metadata: {
    userId: 'usr_abc123',
    planId: 'pro_monthly',
    durationDays: 30,
  },
});

console.log(`Passerelle utilisée : ${payment.provider}`);
console.log(`Lien de paiement pour le client : ${payment.paymentUrl}`);
```

---

### 3. Traitement des Webhooks & Mise à Jour Firebase Firestore

UniPay comprend un gestionnaire prêt à l'emploi pour synchroniser automatiquement l'état des abonnements dans votre base Firestore sans ajouter de complexité :

```typescript
import express from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { WebhookDispatcher, createFirebaseSubscriptionHandler } from 'unipay-africa';

const app = express();
const db = getFirestore(); // Instance Firestore de firebase-admin

// 1. Initialiser le dispatcher de webhooks
const dispatcher = new WebhookDispatcher(unipay.getAllGateways());

// 2. Créer le gestionnaire d'abonnement Firebase
const syncFirebaseSubscription = createFirebaseSubscriptionHandler(db, {
  documentPathPattern: 'users/{userId}/subscriptions/{subscriptionId}',
  defaultDurationDays: 30,
});

// 3. Connecter les événements
dispatcher.on('payment.success', async (event) => {
  console.log(`Paiement confirmé pour ${event.reference}`);
  await syncFirebaseSubscription(event);
});

dispatcher.on('payment.failed', async (event) => {
  console.warn(`Paiement refusé pour ${event.reference}`);
  await syncFirebaseSubscription(event);
});

// 4. Endpoint unique universel
app.post('/api/webhooks/payments', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const rawBody = req.body.toString('utf-8');
    const payload = JSON.parse(rawBody);

    const event = await dispatcher.handleWebhook(payload, {
      rawBody,
      headers: req.headers,
      verifySignature: true, // Vérifie la signature HMAC cryptographique
    });

    res.json({ status: 'success', eventId: event.eventId });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});
```

---

## 🛡️ Résilience et DevOps

| Fonctionnalité | Description |
| :--- | :--- |
| **Circuit Breaker & Retry** | Retries automatiques avec exponential backoff et jitter en cas d'erreur réseau temporaire (502, 503, 504, 429). |
| **Strict Timeout** | Chaque appel dispose d'un timeout configurable avec `AbortSignal.timeout` pour empêcher les blocages de processus. |
| **Timing-safe Equal** | Vérification des signatures de webhooks à temps constant via `crypto.timingSafeEqual` contre les attaques temporelles. |
| **Zero Runtime Dependencies** | Empreinte minimale (< 25 Ko minifié), élimination des risques de failles de sécurité de chaîne d'approvisionnement (Supply Chain Vulnerabilities). |

---

## 🧪 Exécution des Tests

```bash
# Compilation du code TypeScript
npm run build

# Exécution de la suite de tests automatisés
npm test
```

---

## 📄 Licence

Ce projet est sous licence **MIT**. Libre d'utilisation pour tout projet commercial ou open-source.
