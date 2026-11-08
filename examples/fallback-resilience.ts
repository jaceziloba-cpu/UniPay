import {
  UniPayClient,
  FedaPayAdapter,
  CinetPayAdapter,
  CreatePaymentInput,
} from '../src/index.js';

async function main() {
  console.log('--- Démonstration de la haute disponibilité et basculement automatique ---');

  // Configuration de la passerelle primaire avec une mauvaise clé ou URL pour simuler une panne
  const primaryAdapter = new FedaPayAdapter({
    apiKey: 'sk_invalid_failing_key',
    timeoutMs: 2000,
  });

  // Passerelle de secours opérationnelle
  const fallbackAdapter = new CinetPayAdapter({
    apiKey: 'cinetpay_valid_key',
    siteId: 'site_12345',
    isSandbox: true,
  });

  const unipay = new UniPayClient({
    gateways: [primaryAdapter, fallbackAdapter],
    enableFallback: true,
    onFallback: async (event) => {
      console.warn(`[FAILOVER DÉCLENCHÉ]`);
      console.warn(`Passerelle primaire : ${event.primaryProvider} est en échec.`);
      console.warn(`Raison de l'erreur : ${event.error.message}`);
      console.warn(`Basculement automatique vers : ${event.fallbackProvider}`);
      console.warn(`Tentative n° : ${event.attemptNumber}`);
      console.warn('---');
    },
    onError: async (provider, error) => {
      console.error(`[ALERTE OBSERVANTE] Erreur détectée sur ${provider}: ${error.message}`);
    },
  });

  const transactionInput: CreatePaymentInput = {
    reference: `RETRY-${Date.now()}`,
    amount: 15000,
    currency: 'XOF',
    description: 'Abonnement Annuel Premium',
    customer: {
      firstName: 'Awa',
      lastName: 'Diallo',
      email: 'awa.diallo@example.com',
      phoneNumber: '+22507000000',
      country: 'CI',
      city: 'Abidjan',
    },
    metadata: {
      tier: 'premium_annual',
    },
  };

  try {
    const payment = await unipay.createPayment(transactionInput);
    console.log(`Transaction réussie sur la passerelle de secours : ${payment.provider}`);
    console.log(`Lien de paiement généré : ${payment.paymentUrl}`);
  } catch (error) {
    console.error('Tous les prestataires de paiement sont tombés :', error);
  }
}

main().catch(console.error);
