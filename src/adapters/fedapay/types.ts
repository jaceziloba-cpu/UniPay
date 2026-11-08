export interface FedaPayTransactionResponse {
  id: number;
  reference: string;
  amount: number;
  status: 'pending' | 'approved' | 'declined' | 'canceled' | 'transferred' | 'refunded';
  description?: string;
  callback_url?: string;
  created_at: string;
  updated_at: string;
  currency?: {
    iso: string;
  };
  customer?: {
    id: number;
    firstname: string;
    lastname: string;
    email: string;
    phone_number?: {
      number: string;
    };
  };
  custom_metadata?: Record<string, unknown>;
}

export interface FedaPayCreateTransactionResponse {
  'v1/transaction': FedaPayTransactionResponse;
}

export interface FedaPayTokenResponse {
  token: string;
  url: string;
}

export interface FedaPayWebhookPayload {
  name: string; // Ex: 'transaction.approved', 'transaction.canceled'
  entity: FedaPayTransactionResponse;
}
