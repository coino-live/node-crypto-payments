# Coino Live Node.js library

Accept crypto payments with the [Coino Live API](https://coino.live/api-guide). Node.js 18+, no dependencies,
CommonJS and ES modules, TypeScript types included.

## Install

Download `coinolive-node-<version>.zip` from [coino.live/api-guide](https://coino.live/api-guide#libraries), unzip it
into your project (it holds a `coinolive` folder) and install that folder:

```bash
npm install ./coinolive
```

## Take a payment

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

Ship the order when a fresh read says `paid`:

```js
const payment = await coino.payments.retrieve(paymentId);
if (payment.status === 'paid') {
  // …
}
```

Statuses: `open`, `confirming`, `partially_paid`, `paid`, `expired`, `cancelled`.

## Webhooks

The signature covers the raw body, so read it unparsed:

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

## Everything else

```js
await coino.payments.list({ status: 'paid', order_id: '1001' }); // { data: […], meta: { next_cursor, prev_cursor } }
for await (const payment of coino.payments.all({ status: 'paid' })) { /* every page */ }
await coino.payments.cancel(paymentId);                // only while nothing was received

await coino.currencies();                              // prices can be in these
await coino.assets();                                  // customers can pay with these
await coino.balances();                                // your balance per coin, with usd_value

const user = await coino.custody.create({ external_id: 'user-42' }); // lifetime deposit addresses for your users
await coino.custody.retrieve(user.id);
await coino.custody.list({ external_id: 'user-42' });
await coino.custody.deposits(user.id);
await coino.custody.transfer(user.id, 'usdt-tron');    // move the user's balance to yours

await coino.withdrawals.create({ asset: 'usdt-tron', amount: '50', address: 'T…', reference: 'payout-77' });
await coino.withdrawals.retrieve(withdrawalId);
```

## Errors and retries

Every failure rejects with one of these (all exported):

| Error | When |
| --- | --- |
| `AuthenticationError` | Wrong or revoked key, or the gateway is suspended (401) |
| `NotFoundError` | Unknown ID, or it belongs to another gateway (404) |
| `ValidationError` | The request was refused; `e.errors` names the fields (422) |
| `RateLimitError` | Too many requests (429) |
| `ConnectionError` | The API could not be reached, or the request timed out |
| `CoinoLiveError` | Anything else; the parent of all of the above, with `e.status` |

Network errors, 429 and 5xx answers are retried twice with a short pause, but only for requests that are safe to repeat:
reads, `payments.create()` (it always sends an idempotency key, random unless you pass one as the second argument),
`custody.create()` (same `external_id`, same user) and `withdrawals.create()` with a `reference`.

```js
const coino = new CoinoLive('ck_live_…', {
  timeout: 30000,          // milliseconds per request
  maxRetries: 2,
  baseUrl: 'https://coino.live/api/v2',
});
```

## Tests

```bash
node tests/run.mjs
COINOLIVE_API_URL=https://… COINOLIVE_API_KEY=ck_test_… node tests/run.mjs   # also against a real API
```
