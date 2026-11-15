import lib from './index.js';

export const {
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
} = lib;
export default CoinoLive;
