export interface KkiapayInitResponse {
  transactionId: string;
  url?: string;
  payUrl?: string;
  status?: string;
  message?: string;
}

export interface KkiapayCheckResponse {
  transactionId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' | 'CANCELLED';
  amount: number;
  reason?: string;
  externalTransactionId?: string;
  paidAt?: string;
  paymentMethod?: string;
  client?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  form?: Record<string, unknown>;
}

export interface KkiapayWebhookPayload {
  transactionId?: string;
  status?: string;
  amount?: number;
  reason?: string;
  externalTransactionId?: string;
  client?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  form?: Record<string, unknown>;
  [key: string]: unknown;
}
