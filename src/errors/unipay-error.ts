export class UniPayError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'UNIPAY_ERROR') {
    super(message);
    this.name = 'UniPayError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GatewayError extends UniPayError {
  public readonly provider: string;
  public readonly httpStatus?: number;
  public readonly providerErrorCode?: string | number;
  public readonly rawResponse?: unknown;

  constructor(
    provider: string,
    message: string,
    options?: {
      httpStatus?: number;
      providerErrorCode?: string | number;
      rawResponse?: unknown;
    }
  ) {
    super(`[${provider.toUpperCase()}] ${message}`, 'GATEWAY_ERROR');
    this.name = 'GatewayError';
    this.provider = provider;
    this.httpStatus = options?.httpStatus;
    this.providerErrorCode = options?.providerErrorCode;
    this.rawResponse = options?.rawResponse;
  }
}

export class NetworkError extends UniPayError {
  public readonly provider: string;

  constructor(provider: string, message: string, public readonly originalError?: unknown) {
    super(`[${provider.toUpperCase()}] Network error: ${message}`, 'NETWORK_ERROR');
    this.name = 'NetworkError';
    this.provider = provider;
  }
}

export class AuthenticationError extends UniPayError {
  public readonly provider: string;

  constructor(provider: string, message: string) {
    super(`[${provider.toUpperCase()}] Authentication failure: ${message}`, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
    this.provider = provider;
  }
}

export class InvalidSignatureError extends UniPayError {
  public readonly provider: string;

  constructor(provider: string, message: string = 'Webhook cryptographic signature verification failed') {
    super(`[${provider.toUpperCase()}] ${message}`, 'INVALID_SIGNATURE');
    this.name = 'InvalidSignatureError';
    this.provider = provider;
  }
}

export interface GatewayFailureDetail {
  provider: string;
  error: Error;
  attemptedAt: Date;
}

export class FallbackExhaustedError extends UniPayError {
  public readonly failures: GatewayFailureDetail[];

  constructor(message: string, failures: GatewayFailureDetail[]) {
    const summary = failures
      .map((f) => `${f.provider} -> ${f.error.message}`)
      .join(' | ');
    super(
      `All fallback payment gateways failed. Details: [${summary}]. Original: ${message}`,
      'FALLBACK_EXHAUSTED'
    );
    this.name = 'FallbackExhaustedError';
    this.failures = failures;
  }
}
