import {
  UniPayClient,
  type PaymentGatewayAdapter,
  type CreatePaymentInput,
  type PaymentInitializationResult,
  type PaymentVerificationResult,
  type NormalizedWebhookEvent,
  type GatewayCapabilities,
  WebhookDispatcher,
  createFirebaseSubscriptionHandler,
  type FirestoreLike,
} from '../dist/index.js';

// 1. Simulation de la passerelle primaire (FedaPay) subissant une coupure réseau
class FedaPayGatewaySimulation implements PaymentGatewayAdapter {
  public readonly provider = 'fedapay';
  public readonly capabilities: GatewayCapabilities = {
    supportedCurrencies: ['XOF'],
    supportedCountries: ['BJ', 'CI', 'TG'],
    supportsWebhooks: true,
    supportsRefunds: false,
  };

  async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
    console.log(`📡 [1/2] Tentative d'initialisation sur la passerelle primaire (FedaPay)...`);
    throw new Error('ETIMEDOUT: Les serveurs FedaPay ne répondent pas (simulation coupure réseau)');
  }

  async verifyPayment(id: string): Promise<PaymentVerificationResult> { throw new Error(); }
  async parseWebhook(payload: any): Promise<NormalizedWebhookEvent> { throw new Error(); }
  verifyWebhookSignature() { return true; }
}

// 2. Simulation de la passerelle secondaire (CinetPay) opérationnelle
class CinetPayGatewaySimulation implements PaymentGatewayAdapter {
  public readonly provider = 'cinetpay';
  public readonly capabilities: GatewayCapabilities = {
    supportedCurrencies: ['XOF', 'XAF'],
    supportedCountries: ['CI', 'BJ', 'SN'],
    supportsWebhooks: true,
    supportsRefunds: false,
  };

  async createPayment(input: CreatePaymentInput): Promise<PaymentInitializationResult> {
    console.log(`🚀 [2/2] Basculement réussi sur la passerelle de secours (CinetPay) !`);
    return {
      provider: this.provider,
      providerTransactionId: `CP_TX_${Date.now()}`,
      reference: input.reference,
      paymentUrl: `https://checkout.cinetpay.com/payment/token_secours_xyz`,
      status: 'PENDING',
    };
  }

  async verifyPayment(id: string): Promise<PaymentVerificationResult> { throw new Error(); }
  async parseWebhook(payload: any): Promise<NormalizedWebhookEvent> { throw new Error(); }
  verifyWebhookSignature() { return true; }
}

async function runLiveDemo() {
  console.log('====================================================');
  console.log('⚡ DÉMONSTRATION EN DIRECT DU BASCULEMENT UNIPAY');
  console.log('====================================================\n');

  const client = new UniPayClient({
    gateways: [new FedaPayGatewaySimulation(), new CinetPayGatewaySimulation()],
    enableFallback: true,
    onFallback: (event) => {
      console.log(`⚠️  ÉVÉNEMENT DE SECOURS DÉCLENCHÉ :`);
      console.log(`    - Prestataire en panne : ${event.primaryProvider.toUpperCase()}`);
      console.log(`    - Cause : ${event.error.message}`);
      console.log(`    - Redirection vers     : ${event.fallbackProvider.toUpperCase()}`);
      console.log(`    - Développeur notifié en temps réel\n`);
    },
  });

  const transaction = await client.createPayment({
    reference: `COMMANDE_AFRICA_${Date.now()}`,
    amount: 15000,
    currency: 'XOF',
    description: 'Abonnement Annuel Premium',
    customer: {
      firstName: 'Koffi',
      lastName: 'Mensah',
      email: 'koffi@example.com',
      phoneNumber: '+22997000000',
      country: 'BJ',
    },
  });

  console.log('\n✅ TRANSACTION FINALISÉE POUR LE CLIENT :');
  console.log(`   - Passerelle active : ${transaction.provider.toUpperCase()}`);
  console.log(`   - Référence interne : ${transaction.reference}`);
  console.log(`   - Lien de paiement  : ${transaction.paymentUrl}`);
  console.log('====================================================');
}

runLiveDemo().catch(console.error);
