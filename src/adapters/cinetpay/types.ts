export interface CinetPayInitResponse {
  code: string;
  message: string;
  description?: string;
  data?: {
    payment_token: string;
    payment_url: string;
  };
}

export interface CinetPayCheckResponse {
  code: string;
  message: string;
  data?: {
    amount: string | number;
    currency: string;
    status: 'ACCEPTED' | 'REFUSED' | 'CANCELLED' | 'WAITING_FOR_CUSTOMER' | 'WAITING_FOR_PAYMENT' | string;
    payment_method?: string;
    description?: string;
    metadata?: string;
    operator_id?: string;
    payment_date?: string;
    fund_availability_date?: string;
  };
}

export interface CinetPayWebhookPayload {
  cpm_trans_id?: string;
  cpm_site_id?: string;
  cpm_trans_date?: string;
  cpm_amount?: string | number;
  cpm_currency?: string;
  signature?: string;
  payment_method?: string;
  cel_phone_num?: string;
  cpm_phone_prefixe?: string;
  cpm_custom?: string;
  cpm_result?: string;
  cpm_trans_status?: string;
  cpm_error_message?: string;
  [key: string]: unknown;
}
