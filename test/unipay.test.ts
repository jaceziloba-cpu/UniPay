import { test, describe, mock } from 'node:test';
import * as assert from 'node:assert';
import {
  UniPayClient,
  FedaPayAdapter,
  CinetPayAdapter,
  WebhookDispatcher,
  createFirebaseSubscriptionHandler,
  type FirestoreLike,
  type CreatePaymentInput,
  type PaymentGatewayAdapter,
  type PaymentInitializationResult,
  type PaymentVerificationResult,
  type NormalizedWebhookEvent,
  type GatewayCapabilities,
} from '../dist/index.js';
import { FallbackExhaustedError, GatewayError, NetworkError } from '../dist/errors/unipay-error.js';
import { computeHmacSha256 } from '../dist/utils/crypto.js';

describe('UniPay Africa SDK Test Suite', () => {
  // Mock Gateway pour tester le basculement et la résilience
  class MockGateway implements PaymentGatewayAdapter {
    public readonly provider: string;
    public readonly capabilities: GatewayCapabilities = {
      supportedCurrencies: ['XOF', 'XAF'],
      supportedCountries: ['CI', 'BJ', 'SN'],
      supportsWebhooks: true,
      supportsRefunds: false,
    };
    public failWith?: Error;
    public callCount = 0;

    constructor(provider: string, failWith?: Error) {
      this.provider = provider;
      this.failWith = failWith;
    }

    async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
      this.callCount++;
      if (this.failWith) {
        throw this.failWith;
      }
      return {
        provider: this.provider,
        providerTransactionId: `tx_${this.provider}_123`,
        reference: input.reference,
        paymentUrl: `https://mock.checkout/${this.provider}`,
        status: 'PENDING',
      };
    }

    async verifyPayment(transactionId: string): Promise<PaymentVerificationResult> {
      return {
        provider: this.provider,
        providerTransactionId: transactionId,
        reference: 'ref_123',
        status: 'SUCCESSFUL',
        amount: 5000,
        currency: 'XOF',
      };
    }

    async parseWebhook(payload: any): Promise<NormalizedWebhookEvent> {
      return {
        eventId: 'evt_1',
        provider: this.provider,
        eventType: 'payment.success',
        status: 'SUCCESSFUL',
        reference: 'ref_123',
        providerTransactionId: 'tx_123',
        amount: 5000,
        currency: 'XOF',
        timestamp: new Date(),
        rawPayload: payload,
      };
    }

    verifyWebhookSignature(): boolean {
      return true;
    }
  }

  test('UniPayClient - Initialisation standard avec FedaPay et CinetPay', () => {
    const fedapay = new FedaPayAdapter({ apiKey: 'sk_sandbox_test' });
    const cinetpay = new CinetPayAdapter({ apiKey: 'cinet_key', siteId: 'site_1' });

    const client = new UniPayClient({ gateways: [fedapay, cinetpay] });
    assert.strictEqual(client.getAllGateways().length, 2);
    assert.strictEqual(client.gateway('fedapay').provider, 'fedapay');
    assert.strictEqual(client.gateway('cinetpay').provider, 'cinetpay');
  });

  test('UniPayClient - Mécanisme de fallback automatique en cas de panne primaire', async () => {
    const failingPrimary = new MockGateway('primary_gw', new NetworkError('primary_gw', 'Gateway API unreachable'));
    const healthySecondary = new MockGateway('secondary_gw');

    let fallbackEventCaught: any = null;

    const client = new UniPayClient({
      gateways: [failingPrimary, healthySecondary],
      enableFallback: true,
      onFallback: (event) => {
        fallbackEventCaught = event;
      },
    });

    const res = await client.createPayment({
      reference: 'ORDER_99',
      amount: 10000,
      currency: 'XOF',
      description: 'Test fallback',
      customer: {
        firstName: 'Jean',
        lastName: 'Ehouman',
        email: 'jean@example.com',
        phoneNumber: '+22507000000',
        country: 'CI',
      },
    });

    // Vérifie que le premier a échoué et que le deuxième a pris le relais
    assert.strictEqual(failingPrimary.callCount, 1);
    assert.strictEqual(healthySecondary.callCount, 1);
    assert.strictEqual(res.provider, 'secondary_gw');
    assert.strictEqual(res.paymentUrl, 'https://mock.checkout/secondary_gw');

    // Vérifie que l'événement de basculement a été émis
    assert.ok(fallbackEventCaught);
    assert.strictEqual(fallbackEventCaught.primaryProvider, 'primary_gw');
    assert.strictEqual(fallbackEventCaught.fallbackProvider, 'secondary_gw');
  });

  test('UniPayClient - FallbackExhaustedError levé si toutes les passerelles échouent', async () => {
    const gw1 = new MockGateway('gw1', new GatewayError('gw1', 'Server Error 500'));
    const gw2 = new MockGateway('gw2', new NetworkError('gw2', 'Socket hang up'));

    const client = new UniPayClient({
      gateways: [gw1, gw2],
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await client.createPayment({
          reference: 'ORDER_EXHAUSTED',
          amount: 5000,
          currency: 'XOF',
          description: 'Test exhausted',
          customer: {
            firstName: 'Amina',
            lastName: 'Touré',
            email: 'amina@example.com',
            phoneNumber: '+22997000000',
          },
        });
      },
      (err: any) => {
        assert.ok(err instanceof FallbackExhaustedError);
        assert.strictEqual(err.failures.length, 2);
        return true;
      }
    );
  });

  test('WebhookDispatcher - Normalisation et détection automatique FedaPay', async () => {
    const fedapay = new FedaPayAdapter({ apiKey: 'sk_test_123', webhookSecret: 'secret_key_123' });
    const dispatcher = new WebhookDispatcher([fedapay]);

    const rawPayload = {
      name: 'transaction.approved',
      entity: {
        id: 778899,
        reference: 'TX-REF-888',
        amount: 25000,
        status: 'approved',
        currency: { iso: 'XOF' },
        updated_at: '2026-11-08T12:00:00.000Z',
        customer: {
          firstname: 'Fatou',
          lastname: 'Diop',
          email: 'fatou@example.com',
          phone_number: { number: '+221770000000' },
        },
        custom_metadata: {
          merchant_reference: 'ORDER_FATOU_1',
          planId: 'pro_annual',
          userId: 'user_456',
        },
      },
    };

    let eventReceived: NormalizedWebhookEvent | null = null;
    dispatcher.on('payment.success', (event) => {
      eventReceived = event;
    });

    const normalized = await dispatcher.handleWebhook(rawPayload, {
      verifySignature: false,
    });

    assert.strictEqual(normalized.provider, 'fedapay');
    assert.strictEqual(normalized.eventType, 'payment.success');
    assert.strictEqual(normalized.status, 'SUCCESSFUL');
    assert.strictEqual(normalized.amount, 25000);
    assert.strictEqual(normalized.currency, 'XOF');
    assert.strictEqual(normalized.reference, 'ORDER_FATOU_1');
    assert.strictEqual(normalized.customer?.firstName, 'Fatou');
    assert.ok(eventReceived);
  });

  test('Firebase Subscription Handler - Synchronisation automatique dans Firestore', async () => {
    const firestoreStorage = new Map<string, any>();
    const mockFirestore: FirestoreLike = {
      doc: (path: string) => ({
        get: async () => ({
          exists: firestoreStorage.has(path),
          data: () => firestoreStorage.get(path),
        }),
        set: async (data: Record<string, unknown>, options?: { merge: boolean }) => {
          firestoreStorage.set(path, data);
          return data;
        },
        update: async (data: Record<string, unknown>) => {
          firestoreStorage.set(path, { ...firestoreStorage.get(path), ...data });
          return data;
        },
      }),
      collection: (collectionPath: string) => ({
        doc: (docId?: string) => mockFirestore.doc(`${collectionPath}/${docId}`),
      }),
    };

    const handler = createFirebaseSubscriptionHandler(mockFirestore, {
      documentPathPattern: 'users/{userId}/subscriptions/{subscriptionId}',
      defaultDurationDays: 30,
    });

    const mockEvent: NormalizedWebhookEvent = {
      eventId: 'evt_test_firebase',
      provider: 'fedapay',
      eventType: 'payment.success',
      status: 'SUCCESSFUL',
      reference: 'SUB_REF_100',
      providerTransactionId: 'provider_100',
      amount: 7500,
      currency: 'XOF',
      timestamp: new Date('2026-11-08T12:00:00Z'),
      metadata: {
        userId: 'usr_abc_123',
        planId: 'plan_gold',
      },
      rawPayload: {},
    };

    const result = await handler(mockEvent);
    assert.strictEqual(result.path, 'users/usr_abc_123/subscriptions/usr_abc_123_plan_gold');
    assert.strictEqual(result.status, 'ACTIVE');

    const savedDoc = firestoreStorage.get(result.path);
    assert.ok(savedDoc);
    assert.strictEqual(savedDoc.status, 'ACTIVE');
    assert.strictEqual(savedDoc.userId, 'usr_abc_123');
    assert.strictEqual(savedDoc.amount, 7500);
    assert.strictEqual(savedDoc.provider, 'fedapay');
  });

  test('Crypto Utils - Signature HMAC-SHA256 et validation sécurisée', () => {
    const secret = 'super_secret_webhook_key';
    const body = JSON.stringify({ event: 'test', id: 123 });
    const signature = computeHmacSha256(body, secret, 'hex');

    const fedapay = new FedaPayAdapter({ apiKey: 'sk_live_1', webhookSecret: secret });
    const isValid = fedapay.verifyWebhookSignature(body, signature);
    assert.strictEqual(isValid, true);

    const isFakeValid = fedapay.verifyWebhookSignature(body, 'tampered_signature_hex');
    assert.strictEqual(isFakeValid, false);
  });
});
