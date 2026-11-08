export interface PayDunyaInitResponse {
  response_code: string;
  response_text: string;
  description?: string;
  token?: string;
  invoice_token?: string;
}

export interface PayDunyaCheckResponse {
  response_code: string;
  response_text: string;
  invoice?: {
    token: string;
    status: 'pending' | 'completed' | 'cancelled' | 'failed';
    total: number;
    currency: string;
    description: string;
    created_at: string;
    completed_at?: string;
    customer?: {
      name: string;
      phone: string;
      email: string;
    };
  };
  custom_data?: Record<string, unknown>;
}

export interface PayDunyaWebhookPayload {
  data?: {
    invoice?: {
      token: string;
      status: string;
      total: number;
      currency: string;
      custom_data?: Record<string, unknown>;
    };
    custom_data?: Record<string, unknown>;
  };
  [key: string]: unknown;
}
