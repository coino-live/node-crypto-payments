export declare const VERSION: string;

export type PaymentStatus = 'open' | 'confirming' | 'partially_paid' | 'paid' | 'expired' | 'cancelled';

export interface Deposit {
  asset: string;
  symbol: string;
  network: string;
  amount: string;
  tx_hash: string;
  explorer_url: string | null;
  [key: string]: unknown;
}

export interface Payment {
  id: string;
  status: PaymentStatus;
  checkout_url: string;
  order_id: string | null;
  /** The price in USD. */
  amount: string;
  /** The price as requested, e.g. "25.00" "EUR". */
  requested_amount: string;
  requested_currency: string;
  received_usd: string;
  remaining_usd: string;
  metadata: Record<string, unknown> | null;
  deposits: Deposit[];
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface CreatePaymentParams {
  /** A decimal string with at most 2 decimals, e.g. "25.00". */
  amount: string;
  /** Any code from currencies(); USD by default. */
  currency?: string;
  order_id?: string;
  description?: string;
  customer_email?: string;
  success_url?: string;
  cancel_url?: string;
  notify_url?: string;
  metadata?: Record<string, unknown>;
  /** Lock the payment to one coin, e.g. "usdt-tron". */
  asset?: string;
  /** Minutes, 15 to 10080. */
  expires_in?: number;
}

export interface Page<T> {
  data: T[];
  meta: { next_cursor: string | null; prev_cursor: string | null; [key: string]: unknown };
}

export interface CustodyUser {
  id: string;
  external_id: string;
  [key: string]: unknown;
}

export interface CustodyDeposit {
  asset: string;
  amount: string;
  network_fee: string;
  platform_fee: string;
  net: string;
  tx_hash: string;
  credited_at: string;
}

export interface Withdrawal {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface WebhookEvent {
  id: string;
  /** payment.<status>, custody.deposit.detected, custody.deposit.credited, withdrawal.<status> */
  event: string;
  created_at: string;
  data: any;
}

export interface ClientOptions {
  baseUrl?: string;
  /** Milliseconds per request (30000). */
  timeout?: number;
  maxRetries?: number;
}

declare class Payments {
  create(params: CreatePaymentParams, idempotencyKey?: string): Promise<Payment>;
  retrieve(id: string): Promise<Payment>;
  list(filters?: { status?: PaymentStatus; order_id?: string; cursor?: string }): Promise<Page<Payment>>;
  all(filters?: { status?: PaymentStatus; order_id?: string }): AsyncGenerator<Payment>;
  cancel(id: string): Promise<Payment>;
}

declare class Custody {
  create(params: { external_id: string; name?: string; email?: string; metadata?: Record<string, unknown> }): Promise<CustodyUser>;
  retrieve(id: string): Promise<CustodyUser>;
  list(filters?: { external_id?: string; cursor?: string }): Promise<Page<CustodyUser>>;
  deposits(id: string, cursor?: string): Promise<{ data: CustodyDeposit[]; next_cursor: string | null }>;
  transfer(id: string, asset: string, amount?: string): Promise<{ id: string; asset: string; amount: string; custody_user: string; created_at: string }>;
}

declare class Withdrawals {
  create(params: { asset: string; amount: string; address: string; custody_user?: string; reference?: string }): Promise<Withdrawal>;
  retrieve(id: string): Promise<Withdrawal>;
}

export declare class CoinoLive {
  constructor(apiKey: string, options?: ClientOptions);
  readonly payments: Payments;
  readonly custody: Custody;
  readonly withdrawals: Withdrawals;
  currencies(): Promise<Array<{ code: string; usd_per_unit: string; [key: string]: unknown }>>;
  assets(): Promise<Array<{ code: string; symbol: string; name: string; network: string; decimals: number; price_usd: string | null }>>;
  balances(): Promise<Array<{ asset: string; symbol: string; network: string; balance: string; usd_value: string | null; [key: string]: unknown }>>;
}

export declare const webhooks: {
  /** Throws SignatureVerificationError when the signature is missing, wrong or older than tolerance seconds (300). */
  verify(payload: string | Buffer, signatureHeader: string | undefined, secret: string, tolerance?: number): WebhookEvent;
};

export declare class CoinoLiveError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;
}
export declare class AuthenticationError extends CoinoLiveError {}
export declare class NotFoundError extends CoinoLiveError {}
export declare class ValidationError extends CoinoLiveError {}
export declare class RateLimitError extends CoinoLiveError {}
export declare class ConnectionError extends CoinoLiveError {}
export declare class SignatureVerificationError extends Error {}

export default CoinoLive;
