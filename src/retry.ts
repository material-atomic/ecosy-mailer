/** Configuration for the {@link Retry} mechanism. */
export interface RetryOptions {
  /**
   * Maximum number of retries (does not count the initial attempt).
   * For example, `retries: 2` means up to 3 total attempts.
   * @defaultValue 1
   */
  retries?: number;
  /**
   * Initial delay in milliseconds before the first retry.
   * @defaultValue 3000
   */
  delay?: number;
  /**
   * Multiplier applied to the delay after each failure (exponential backoff).
   * Set to `1` for a fixed delay.
   * @defaultValue 1
   */
  backoffFactor?: number;
}

interface Callback<T> {
  (): Promise<T>;
}

/**
 * Wraps an async operation with automatic retry and exponential backoff.
 *
 * @example
 * ```ts
 * const retry = new Retry({ retries: 2, delay: 1000, backoffFactor: 2 });
 * await retry.retry(() => sendMail(payload));
 * // Attempt 1 → fail → wait 1s → Attempt 2 → fail → wait 2s → Attempt 3
 * ```
 */
export class Retry {
  /** Default delay in milliseconds. */
  static DEFAULT_DELAY = 3000;

  constructor(private options: RetryOptions = {}) {}

  /** Merges new options into the current configuration. */
  setOptions(options: RetryOptions) {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Executes the callback with retry logic.
   * Throws an `Error` with `{ cause }` preserving the original stack trace
   * if all attempts are exhausted.
   *
   * @param callback - Async function to execute.
   * @returns The callback's resolved value.
   */
  async retry<T>(callback: Callback<T>): Promise<T> {
    // Use ?? to respect explicit 0 values
    const maxRetries = this.options.retries ?? 1;
    const factor = this.options.backoffFactor ?? 1;
    let currentDelay = this.options.delay ?? Retry.DEFAULT_DELAY;

    const totalAttempts = 1 + maxRetries;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        return await callback();
      } catch (error) {
        lastError = error;

        // Final attempt — throw with preserved cause
        if (attempt === totalAttempts) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          throw new Error(
            `[Mailer Retry] Failed after ${totalAttempts} attempts. Last error: ${errorMessage}`,
            { cause: error }
          );
        }

        await Retry.sleep(currentDelay);

        // Apply exponential backoff
        // e.g. delay=1000, factor=2 → 1000ms, 2000ms, 4000ms...
        currentDelay *= factor;
      }
    }

    // Unreachable — the loop always throws on the final attempt
    throw lastError;
  }

  /** Returns a promise that resolves after `ms` milliseconds. */
  static sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
