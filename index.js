'use strict';

/**
 * Coino Live API v2 client for Node.js 18+ (built-in fetch, no dependencies).
 *
 *   const { CoinoLive } = require('coinolive');
 *   const coino = new CoinoLive('ck_live_…');
 *   const payment = await coino.payments.create({ amount: '25.00', currency: 'EUR', order_id: '1001' });
 *   res.redirect(payment.checkout_url);
 */

const crypto = require('node:crypto');

const VERSION = '1.0.0';
const DEFAULT_BASE_URL = 'https://coino.live/api/v2';

/** The API refused the request; message says why. */
class CoinoLiveError extends Error {
  constructor(message, status = 0, errors = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    /** Field errors, when the API names fields: { amount: ['…'] }. */
    this.errors = errors;
  }
}
/** Missing, wrong or revoked API key, or the gateway is suspended (401). */
class AuthenticationError extends CoinoLiveError {}
/** Not found, or it belongs to another gateway (404). */
class NotFoundError extends CoinoLiveError {}
/** The request was refused; errors names the fields (422). */
class ValidationError extends CoinoLiveError {}
/** Too many requests (429). Retried automatically, then thrown. */
class RateLimitError extends CoinoLiveError {}
/** Coino Live could not be reached (network, DNS, timeout). Retried automatically, then thrown. */
class ConnectionError extends CoinoLiveError {}
/** A webhook whose signature is missing, wrong or too old: refuse it. */
class SignatureVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}

function query(params = {}) {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return pairs.length ? '?' + new URLSearchParams(pairs.map(([k, v]) => [k, String(v)])).toString() : '';
}

const id = (value) => encodeURIComponent(String(value));

/** Payments: create one per order, send the customer to its checkout_url, read it back before shipping. */
class Payments {
  constructor(client) {
    this._client = client;
  }

  /**
   * Creates a payment. Without an idempotency key a random one is used, so a retried request never creates a
   * second payment. Pass your own key (for example "order-1001-1") to make repeating the call from your code safe too.
   */
  async create(params, idempotencyKey) {
    const key = idempotencyKey || crypto.randomBytes(16).toString('hex');
    return (await this._client.request('POST', '/payments', params, { idempotencyKey: key })).data;
  }

  async retrieve(paymentId) {
    return (await this._client.request('GET', '/payments/' + id(paymentId))).data;
  }

  /** One page of payments (50), newest first: { data, meta: { next_cursor, prev_cursor } }. */
  list(filters = {}) {
    return this._client.request('GET', '/payments' + query(filters));
  }

  /** Every payment matching the filters, fetching pages as you go: for await (const p of coino.payments.all()). */
  async *all(filters = {}) {
    let cursor = filters.cursor;
    do {
      const page = await this.list({ ...filters, cursor });
      yield* page.data;
      cursor = page.meta && page.meta.next_cursor;
    } while (cursor);
  }

  /** Cancels an open payment that has received nothing. */
  async cancel(paymentId) {
    return (await this._client.request('POST', '/payments/' + id(paymentId) + '/cancel', undefined, { repeatable: true })).data;
  }
}

/** Custody users: lifetime deposit addresses and balances for the users of your app. */
class Custody {
  constructor(client) {
    this._client = client;
  }

  /** Creates a user, or returns the existing one with the same external_id. */
  async create(params) {
    return (await this._client.request('POST', '/custody/users', params, { repeatable: true })).data;
  }

  async retrieve(userId) {
    return (await this._client.request('GET', '/custody/users/' + id(userId))).data;
  }

  /** One page of users (50), newest first: { data, meta: { next_cursor, prev_cursor } }. */
  list(filters = {}) {
    return this._client.request('GET', '/custody/users' + query(filters));
  }

  /** One page of a user's credited deposits (50), newest first: { data, next_cursor }. */
  deposits(userId, cursor) {
    return this._client.request('GET', '/custody/users/' + id(userId) + '/deposits' + query({ cursor }));
  }

  /** Moves a user's balance of one asset to your main balance: all of it, or just amount. */
  async transfer(userId, asset, amount) {
    const body = amount === undefined || amount === null ? { asset } : { asset, amount: String(amount) };
    return (await this._client.request('POST', '/custody/users/' + id(userId) + '/transfers', body)).data;
  }
}

/** API withdrawals. Turn them on in the gateway settings first. */
class Withdrawals {
  constructor(client) {
    this._client = client;
  }

  /**
   * Sends coins from your balance (or a custody user's balance) to an address.
   * Give a reference: the same reference returns the same withdrawal, so a retried request never pays twice.
   */
  async create(params) {
    return (await this._client.request('POST', '/withdrawals', params, { repeatable: Boolean(params && params.reference) })).data;
  }

  async retrieve(withdrawalId) {
    return (await this._client.request('GET', '/withdrawals/' + id(withdrawalId))).data;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CoinoLive {
  /**
   * @param {string} apiKey ck_live_… (Dashboard → Developers)
   * @param {{baseUrl?: string, timeout?: number, maxRetries?: number}} [options] timeout in milliseconds (30000)
   */
  constructor(apiKey, options = {}) {
    if (typeof apiKey !== 'string' || !/^ck_(live|test)_[A-Za-z0-9]+$/.test(apiKey)) {
      throw new TypeError('An API key looks like ck_live_… (create one in your dashboard under Developers).');
    }
    this._apiKey = apiKey;
    this._baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!this._baseUrl.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(this._baseUrl)) {
      throw new TypeError('baseUrl must start with https://.');
    }
    this._timeout = options.timeout ?? 30000;
    this._maxRetries = Math.max(0, options.maxRetries ?? 2);

    this.payments = new Payments(this);
    this.custody = new Custody(this);
    this.withdrawals = new Withdrawals(this);
  }

  /** Currencies a payment can be priced in: [{ code: 'EUR', usd_per_unit: '1.09' }, …]. */
  async currencies() {
    return (await this.request('GET', '/currencies')).data;
  }

  /** Coins customers can pay with right now. */
  async assets() {
    return (await this.request('GET', '/assets')).data;
  }

  /** Your account balance per coin, after fees. */
  async balances() {
    return (await this.request('GET', '/balances')).data;
  }

  /** @internal Use the resources. Resolves to the decoded JSON answer. */
  async request(method, path, body, { idempotencyKey, repeatable = false } = {}) {
    // Retrying a POST is only safe when repeating it returns the same object (an idempotency key, a custody
    // external_id, a withdrawal reference).
    const retriable = method === 'GET' || Boolean(idempotencyKey) || repeatable;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._send(method, path, body, idempotencyKey);
      } catch (e) {
        const temporary = e instanceof ConnectionError || e instanceof RateLimitError || (e instanceof CoinoLiveError && e.status >= 500);
        if (!retriable || !temporary || attempt >= this._maxRetries) {
          throw e;
        }
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
  }

  async _send(method, path, body, idempotencyKey) {
    const headers = {
      Authorization: 'Bearer ' + this._apiKey,
      Accept: 'application/json',
      'User-Agent': `coinolive-node/${VERSION} node/${process.version}`,
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    let text;
    try {
      response = await fetch(this._baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(this._timeout),
      });
      text = await response.text();
    } catch (e) {
      const reason = e && e.cause && e.cause.message ? e.cause.message : e && e.message;
      throw new ConnectionError('Could not reach Coino Live: ' + reason);
    }

    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    const isObject = json !== null && typeof json === 'object';
    const status = response.status;

    if (status >= 200 && status < 300 && isObject) {
      return json;
    }
    if ((status >= 300 && status < 400) || (status === 404 && !isObject)) {
      throw new CoinoLiveError(`There is no Coino Live API at ${this._baseUrl} (HTTP ${status}). Check baseUrl.`, status);
    }

    const message = isObject && json.message ? String(json.message) : 'HTTP ' + status;
    const errors = isObject && json.errors && typeof json.errors === 'object' ? json.errors : {};
    const ErrorClass = { 401: AuthenticationError, 404: NotFoundError, 422: ValidationError, 429: RateLimitError }[status] || CoinoLiveError;
    throw new ErrorClass(message, status, errors);
  }
}

/**
 * Webhook signatures: X-Coino-Signature: t=<unix time>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>.
 * Pass the raw body (a string or Buffer, e.g. from express.raw({ type: 'application/json' })), not parsed JSON.
 *
 *   const event = webhooks.verify(req.body, req.get('X-Coino-Signature'), secret);
 *   const payment = await coino.payments.retrieve(event.data.id); // Read the payment before acting on it.
 */
const webhooks = {
  verify(payload, signatureHeader, secret, tolerance = 300) {
    const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    if (typeof body !== 'string') {
      throw new SignatureVerificationError('Pass the raw request body (a string or Buffer), not parsed JSON.');
    }
    const parts = {};
    for (const pair of String(signatureHeader || '').split(',')) {
      const at = pair.indexOf('=');
      if (at > 0) {
        parts[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
      }
    }
    if (!parts.t || !parts.v1 || !/^\d+$/.test(parts.t)) {
      throw new SignatureVerificationError('The X-Coino-Signature header is missing or malformed.');
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > tolerance) {
      throw new SignatureVerificationError('The signature is too old.');
    }
    const expected = Buffer.from(crypto.createHmac('sha256', secret).update(parts.t + '.' + body).digest('hex'));
    const given = Buffer.from(parts.v1);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new SignatureVerificationError('The signature does not match.');
    }
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new SignatureVerificationError('The payload is not JSON.');
    }
  },
};

module.exports = {
  CoinoLive,
  webhooks,
  VERSION,
  CoinoLiveError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ConnectionError,
  SignatureVerificationError,
};
module.exports.default = CoinoLive;
