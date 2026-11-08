export type Currency = 'XOF' | 'XAF' | 'GNF' | 'CDF' | 'USD' | 'EUR';

export type AfricanCountryCode =
  | 'BJ' // Bénin
  | 'CI' // Côte d'Ivoire
  | 'SN' // Sénégal
  | 'TG' // Togo
  | 'ML' // Mali
  | 'BF' // Burkina Faso
  | 'NE' // Niger
  | 'CM' // Cameroun
  | 'GN' // Guinée Conakry
  | 'CD' // République Démocratique du Congo
  | 'GA'; // Gabon

export type PaymentMethodType =
  | 'mobile_money'
  | 'card'
  | 'wave'
  | 'orange_money'
  | 'mtn_momo'
  | 'moov_money'
  | 'all';

export type TransactionStatus =
  | 'PENDING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface CustomerInfo {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string; // Ex: +22997000000 ou +22507000000
  address?: string;
  city?: string;
  country?: AfricanCountryCode;
}

export interface CreatePaymentInput {
  /** Référence unique de la transaction dans le système marchand */
  reference: string;
  /** Montant de la transaction (en unité principale, ex: 5000 pour 5000 FCFA) */
  amount: number;
  /** Devise de la transaction */
  currency: Currency;
  /** Description visible par l'utilisateur */
  description: string;
  /** Informations sur le client */
  customer: CustomerInfo;
  /** URL de redirection après un paiement réussi ou en attente */
  returnUrl?: string;
  /** URL de notification webhook pour la passerelle */
  callbackUrl?: string;
  /** Canaux de paiement ciblés ou restreints */
  paymentMethod?: PaymentMethodType;
  /** Métadonnées personnalisées à propager */
  metadata?: Record<string, string | number | boolean>;
}

export interface PaymentInitializationResult {
  /** Nom du fournisseur qui a traité la transaction */
  provider: string;
  /** Identifiant unique de transaction chez le fournisseur */
  providerTransactionId: string;
  /** Référence marchand d'origine */
  reference: string;
  /** URL vers laquelle rediriger le client pour payer */
  paymentUrl: string;
  /** Token de paiement généré si applicable */
  token?: string;
  /** Statut initial */
  status: TransactionStatus;
  /** Données brutes renvoyées par la passerelle */
  rawResponse?: unknown;
}

export interface PaymentVerificationResult {
  provider: string;
  providerTransactionId: string;
  reference: string;
  status: TransactionStatus;
  amount: number;
  currency: Currency;
  paidAt?: Date;
  customer?: Partial<CustomerInfo>;
  paymentMethodUsed?: string;
  rawResponse?: unknown;
}
