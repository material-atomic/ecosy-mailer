import { Retry } from './retry';

/** Configuration for the {@link RateLimiter}. */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the interval window. */
  maxRequests?: number;
  /** Time window in milliseconds. */
  interval?: number;
  /**
   * Execution mode:
   * - `"concurrent"` (default): Fire-and-forget — tasks run in parallel.
   * - `"serial"`: Each task must complete before the next one starts.
   */
  mode?: 'serial' | 'concurrent';
}

interface Callback<T> {
  (): Promise<T>;
}

/**
 * Rate limiter with a sliding-window algorithm.
 * Supports both concurrent (default) and serial execution modes.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ maxRequests: 5, interval: 1000 });
 * await limiter.handle(() => sendEmail(payload));
 * ```
 */
export class RateLimiter {
  /** Default interval in milliseconds. */
  static DEFAULT_DELAY = 3000;
  /** Default max requests per interval. */
  static DEFAULT_MAX_REQUESTS = 1;

  private queueItems: Array<() => Promise<void>> = [];
  private requestTimes: number[] = [];
  private executing = false;

  constructor(private options: RateLimitOptions = {}) {}

  /** Merges new options into the current configuration. */
  setOptions(options: RateLimitOptions) {
    this.options = { ...this.options, ...options };
    return this;
  }

  /** Waits until a slot becomes available within the rate window. */
  private async waitForSlot(): Promise<void> {
    const interval = this.options.interval ?? RateLimiter.DEFAULT_DELAY;
    const maxRequests = this.options.maxRequests ?? RateLimiter.DEFAULT_MAX_REQUESTS;
    let now = Date.now();

    // Prune timestamps outside the current window
    this.requestTimes = this.requestTimes.filter((time) => time > now - interval);

    if (this.requestTimes.length >= maxRequests) {
      const oldestRequest = this.requestTimes[0];
      const delay = oldestRequest + interval - now;
      await Retry.sleep(delay);
      now = Date.now();
    }

    this.requestTimes.push(now);
  }

  /**
   * Internal orchestrator loop.
   * Slot allocation is serial, but task execution respects the configured mode.
   */
  private async processQueue() {
    if (this.executing) return;
    this.executing = true;

    while (this.queueItems.length > 0) {
      await this.waitForSlot();

      const task = this.queueItems.shift();

      if (task) {
        if (this.options.mode === 'serial') {
          // Serial: block until the task completes
          await task();
        } else {
          // Concurrent (default): fire-and-forget
          task();
        }
      }
    }

    this.executing = false;
  }

  /**
   * Enqueues a callback and returns a promise that resolves when it completes.
   *
   * @param callback - Async function to rate-limit.
   * @returns The callback's resolved value.
   */
  handle<T>(callback: Callback<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queueItems.push(async () => {
        try {
          const result = await callback();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }
}
