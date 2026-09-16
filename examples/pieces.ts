/** `Retry` and `RateLimiter` on their own — neither needs a mailer. */
import { RateLimiter, Retry } from "@ecosy/mailer";

/** Three attempts, waiting 1s then 2s. */
export const withRetry = <T>(work: () => Promise<T>): Promise<T> =>
  new Retry({ retries: 2, delay: 1000, backoffFactor: 2 }).retry(work);

/** Five a second, each waiting for the one before it. */
const limiter = new RateLimiter({ maxRequests: 5, interval: 1000, mode: "serial" });

export const limited = <T>(work: () => Promise<T>): Promise<T> => limiter.handle(work);
