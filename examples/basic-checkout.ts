import { UniPayClient, FedaPayAdapter, CinetPayAdapter } from '../src/index.js';

async function main() {
  // 1. Initialiser le client UniPay avec les passerelles désirées
  const unipay = new UniPayClient({
    gateways: [
      new FedaPayAdapter({
        apiKey: process.env.FEDAPAY_SECRET_KEY || 'sk_sandbox_test_token_123',
        isSandbox: true,
      }),
      new CinetPayAdapter({
        apiKey: process.env.CINETPAY_API_KEY || '1234567890abcdef',
        siteId: process.env.CINETPAY_SITE_ID || '123456',
        isSandbox: true,
      }),
    ],
  });

  console.log('--- Initialisation d’un paiement pour le Bénin / Côte d’Ivoire ---');

  // 2. Créer une transaction universelle
  const payment = await unipay.createPayment({
    reference: `ORD-${Date.now()}`,
    amount: 5000,
    currency: 'XOF',
    description: 'Abonnement mensuel UniPay Pro',
    returnUrl: 'https://mon-app.africa/payment/complete',
    callbackUrl: 'https://api.mon-app.africa/webhooks/unipay',
    customer: {
      firstName: 'Koffi',
      lastName: 'Mensah',
      email: 'koffi.mensah@example.com',
      phoneNumber: '+22997000000',
      country: 'BJ',
      city: 'Cotonou',
    },
    metadata: {
      userId: 'usr_789456',
      planId: 'plan_pro_monthly',
    },
  });

  console.log(`Paiement initialisé avec succès !`);
  console.log(`Fournisseur sélectionné : ${payment.provider}`);
  console.log(`URL de paiement : ${payment.paymentUrl}`);
  console.log(`Référence : ${payment.reference}`);
}

main().catch(console.error);
