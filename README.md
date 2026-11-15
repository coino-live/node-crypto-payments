# Coino Live Node.js & TypeScript Library for Crypto Payments

The official Node.js library, version 1.0.0 (MIT), for the [Coino Live REST API v2](https://coino.live/api-guide). [Coino Live](https://coino.live) is a crypto payment gateway. Your customer pays in crypto, the payment is credited to your Coino Live balance, and you withdraw it to your own wallet.

Use the client to:

- create a payment and redirect to `checkout_url`
- verify webhooks
- list and cancel payments
- check balances
- issue lifetime deposit addresses for your users
- send withdrawals

## Features, supported crypto and fees

- **Node.js 18+**, no dependencies, CommonJS and ES modules, TypeScript types included
- **117 assets on 11 networks**: Bitcoin, Litecoin, Ethereum, BNB Smart Chain, opBNB, Polygon, Base, Arbitrum, TRON, TON and Solana. USDT and USDC are available on most of them. Dogecoin and Bitcoin Cash are not accepted.
- **0.25% platform fee** per payment. Blockchain network fees are separate.
- **No KYC**: sign up at [coino.live](https://coino.live) with an email and password.

## Requirements

- Node.js 18 or later
- A Coino Live API key (Dashboard → Developers)

## Install

1. Download `coinolive-node-<version>.zip` from [coino.live/api-guide](https://coino.live/api-guide#libraries).
2. Unzip it into your project. It holds a `coinolive` folder.
3. Install that folder:

```bash
npm install ./coinolive
```

## Accept a crypto payment

Create a payment, then redirect the customer to the checkout URL:

```js
const { CoinoLive } = require('coinolive'); // or: import { CoinoLive } from 'coinolive';

const coino = new CoinoLive('ck_live_…'); // Dashboard → Developers

const payment = await coino.payments.create({
  amount: '25.00',          // a string, at most 2 decimals
  currency: 'EUR',          // any code from coino.currencies(); USD by default
  order_id: '1001',
  success_url: 'https://shop.example/thanks',
  cancel_url: 'https://shop.example/cart',
  notify_url: 'https://shop.example/coino-webhook',
});

res.redirect(payment.checkout_url);
```

### Confirm the payment before shipping

Ship the order only when a fresh read from the API says `paid`:

```js
const payment = await coino.payments.retrieve(paymentId);
if (payment.status === 'paid') {
  // …
}
```

Payment statuses: `open`, `confirming`, `partially_paid`, `paid`, `expired`, `cancelled`.

## Verify payment webhooks

The signature covers the raw request body, so read it unparsed. Act on a fresh `payments.retrieve()`, not on the webhook body.

```js
const { webhooks, SignatureVerificationError } = require('coinolive');

app.post('/coino-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = webhooks.verify(req.body, req.get('X-Coino-Signature'), process.env.COINO_SIGNING_SECRET);
  } catch (e) {
    return res.sendStatus(401);
  }
  if (event.event.startsWith('payment.')) {
    const payment = await coino.payments.retrieve(event.data.id); // act on what the API says, not on the webhook body
  }
  res.sendStatus(200);
});
```

## List and cancel payments

```js
await coino.payments.list({ status: 'paid', order_id: '1001' }); // { data: […], meta: { next_cursor, prev_cursor } }
for await (const payment of coino.payments.all({ status: 'paid' })) { /* every page */ }
await coino.payments.cancel(paymentId);                // only while nothing was received
```

## Check currencies, assets and balances

`currencies()` lists what you can price payments in. `assets()` lists what customers can pay with.

```js
await coino.currencies();                              // prices can be in these
await coino.assets();                                  // customers can pay with these
await coino.balances();                                // your balance per coin, with usd_value
```

## Give your users lifetime deposit addresses (custody)

```js
const user = await coino.custody.create({ external_id: 'user-42' }); // lifetime deposit addresses for your users
await coino.custody.retrieve(user.id);
await coino.custody.list({ external_id: 'user-42' });
await coino.custody.deposits(user.id);
await coino.custody.transfer(user.id, 'usdt-tron');    // move the user's balance to yours
```

## Withdraw funds to your wallet

```js
await coino.withdrawals.create({ asset: 'usdt-tron', amount: '50', address: 'T…', reference: 'payout-77' });
await coino.withdrawals.retrieve(withdrawalId);
```

## Error handling and automatic retries

Every failure rejects with one of these errors (all exported):

| Error | When |
| --- | --- |
| `AuthenticationError` | Wrong or revoked key, or the gateway is suspended (401) |
| `NotFoundError` | Unknown ID, or it belongs to another gateway (404) |
| `ValidationError` | The request was refused; `e.errors` names the fields (422) |
| `RateLimitError` | Too many requests (429) |
| `ConnectionError` | The API could not be reached, or the request timed out |
| `CoinoLiveError` | Anything else; the parent of all of the above, with `e.status` |

Network errors, 429 responses and 5xx responses are retried twice with a short pause. Retries only happen for requests that are safe to repeat:

- reads
- `payments.create()`, which always sends an idempotency key (random, unless you pass one as the second argument)
- `custody.create()`, because the same `external_id` gives the same user
- `withdrawals.create()` with a `reference`

Set the request timeout, retry count and API base URL:

```js
const coino = new CoinoLive('ck_live_…', {
  timeout: 30000,          // milliseconds per request
  maxRetries: 2,
  baseUrl: 'https://coino.live/api/v2',
});
```

## Run the tests

```bash
node tests/run.mjs
COINOLIVE_API_URL=https://… COINOLIVE_API_KEY=ck_test_… node tests/run.mjs   # also against a real API
```

## License

MIT
