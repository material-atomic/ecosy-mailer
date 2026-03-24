import { Formatter } from './formatter';
import { Retry, type RetryOptions } from './retry';
import { RateLimiter, type RateLimitOptions } from './rate-limiter';
import type {
  Attachment,
  Components,
  DriverLike,
  LoggerLike,
  MailerAddress,
  MailerFrom,
  ObjectOf,
  SendOptions,
  TransporterLike,
  TransportOptions,
} from './types';

/** Options for constructing a {@link Mailer} instance. */
export interface MailerOptions extends TransportOptions {
  /** Email body template content (supports Formatter directives). */
  content?: string;
  /** Email subject template (supports variable interpolation). */
  subject?: string;
  /** Optional logger for structured debug/error output. */
  logger?: LoggerLike;
}

/** Static configuration for {@link Mailer.from} factory method. */
export interface MailerStatic<T = unknown> {
  /** Mail transport driver (e.g. Nodemailer). */
  driver: DriverLike;
  /** Combined transport + send options. */
  options: MailerOptions & Omit<SendOptions, 'html'>;
  /** Named template components. */
  components?: Components;
  /** Initial data context for the template. */
  data?: ObjectOf<T>;
  /** Retry configuration. */
  retry?: RetryOptions;
  /** Rate limit configuration. */
  rateLimit?: RateLimitOptions;
  /** Optional logger for structured debug/error output. */
  logger?: LoggerLike;
}

/**
 * Fluent email builder with template formatting, retry, and rate limiting.
 *
 * @example
 * ```ts
 * const mailer = Mailer.from({
 *   driver: nodemailer,
 *   options: {
 *     host: 'smtp.example.com',
 *     port: 587,
 *     auth: { user: 'u', pass: 'p' },
 *     from: 'noreply@example.com',
 *     to: 'user@example.com',
 *     subject: 'Hello {user.name}',
 *     content: '<p>Welcome, {user.name}!</p>',
 *   },
 *   data: { user: { name: 'Alice' } },
 *   retry: { retries: 2, delay: 1000 },
 *   rateLimit: { maxRequests: 5, interval: 1000 },
 * });
 *
 * await mailer.send();
 * ```
 */
export class Mailer<T = unknown> {
  private readonly transporter: TransporterLike;
  private readonly Formatter: Formatter<T>;
  private readonly Subject: Formatter<T>;

  private Retry?: Retry;
  private RateLimiter?: RateLimiter;

  private headers: ObjectOf<string> = {};
  private replyTo?: MailerAddress;
  private attachments: Array<string | Attachment> = [];
  private cc?: MailerAddress;
  private bcc?: MailerAddress;
  private from?: MailerFrom;
  private to?: MailerAddress;

  private _logger?: LoggerLike;

  constructor(
    private readonly driver: DriverLike,
    options: MailerOptions & Omit<SendOptions, 'html'>
  ) {
    this.Formatter = new Formatter<T>(options.content || '');
    this.Subject = new Formatter<T>(options.subject || '');
    this.transporter = this.createTransporter(options);
    this._logger = options.logger;
    this.extractOptions(options);
  }

  // =====================================================================
  // Initialization
  // =====================================================================

  private extractOptions(options: SendOptions) {
    this.headers = options.headers || {};
    this.replyTo = options.replyTo || options.from;
    this.attachments = options.attachments || [];
    this.cc = options.cc;
    this.bcc = options.bcc;
    this.from = options.from;
    this.to = options.to;
  }

  private createTransporter(options: MailerOptions) {
    return this.driver.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      auth: options.auth,
    });
  }

  /** Merges global headers with attachment-level headers. */
  private mergeHeaders(attachmentHeaders?: Attachment['headers']): Attachment['headers'] {
    if (!attachmentHeaders) {
      return this.headers;
    }

    // Array-style attachment headers: convert global headers to array format
    if (Array.isArray(attachmentHeaders)) {
      const globalHeadersArray = Object.entries(this.headers).map(([key, value]) => ({
        key,
        value,
      }));
      return [...globalHeadersArray, ...attachmentHeaders];
    }

    // Object-style: simple spread merge
    return {
      ...this.headers,
      ...attachmentHeaders,
    };
  }

  // =====================================================================
  // Attachments
  // =====================================================================

  /** Resolves attachments, merging headers and handling string paths. */
  private getAttachments(): Attachment[] | undefined {
    if (!this.attachments || this.attachments.length === 0) {
      return undefined;
    }

    return this.attachments.map<Attachment>((attachment) => {
      if (typeof attachment === 'object' && attachment !== null && !Array.isArray(attachment)) {
        return {
          ...attachment,
          headers: this.mergeHeaders(attachment.headers),
        };
      }

      // String attachment — treat as file path
      return {
        headers: this.headers,
        raw: { path: attachment as string },
      };
    });
  }

  /**
   * Returns the logger instance, or `null` if logging is globally disabled
   * via `MAILER_LOGGING=false` environment variable.
   */
  get logger(): LoggerLike | null | undefined {
    // Globally disable logging when MAILER_LOGGING env var is set to "false"
    if (
      typeof process !== "undefined" &&
      typeof process.env !== "undefined" &&
      process.env.MAILER_LOGGING?.toString()?.toLowerCase() === "false"
    ) {
      return null;
    }
    
    return this._logger;
  }

  // =====================================================================
  // Fluent setters
  // =====================================================================

  /** Sets the logger instance for send pipeline diagnostics. */
  setLogger(logger: LoggerLike) {
    this._logger = logger;
    return this;
  }

  /** Updates sender options and optionally the subject template. */
  setSender(options: SendOptions) {
    this.extractOptions(options);
    if (options.subject) {
      this.Subject.setContent(options.subject);
    }
    return this;
  }

  /** Registers named components for the template engine. */
  setComponents(components: Components) {
    this.Formatter.setComponents(components);
    return this;
  }

  /** Sets the data context for both body and subject templates. */
  setData(data: ObjectOf<T>) {
    this.Formatter.setData(data);
    this.Subject.setData(data);
    return this;
  }

  /** Sets custom email headers. */
  setHeaders(headers: ObjectOf<string>) {
    this.headers = headers;
    return this;
  }

  /** Sets the reply-to address. */
  setReplyTo(replyTo: MailerAddress) {
    this.replyTo = replyTo;
    return this;
  }

  /** Sets the CC address(es). */
  setCc(cc: MailerAddress) {
    this.cc = cc;
    return this;
  }

  /** Sets the BCC address(es). */
  setBcc(bcc: MailerAddress) {
    this.bcc = bcc;
    return this;
  }

  /** Sets the sender address. */
  setFrom(from: MailerFrom) {
    this.from = from;
    return this;
  }

  /** Sets the recipient address(es). */
  setTo(to: MailerAddress) {
    this.to = to;
    return this;
  }

  /** Configures automatic retry with exponential backoff. */
  setRetry(options: RetryOptions) {
    if (!this.Retry) {
      this.Retry = new Retry(options);
    } else {
      this.Retry.setOptions(options);
    }
    return this;
  }

  /** Configures rate limiting for send operations. */
  setRateLimit(options: RateLimitOptions) {
    if (!this.RateLimiter) {
      this.RateLimiter = new RateLimiter(options);
    } else {
      this.RateLimiter.setOptions(options);
    }
    return this;
  }

  /** Returns the formatted email body. */
  getContent() { return this.Formatter.format(); }

  /** Returns the formatted email subject. */
  getSubject() { return this.Subject.format(); }

  // =====================================================================
  // Send pipeline
  // =====================================================================

  /** Assembles the payload and delegates to the transporter. */
  private async executeSend() {
    const subject = this.getSubject();
    this.logger?.debug?.(`[Mailer] Building payload for: "${subject}"`);

    const payload = {
      from: this.from,
      to: this.to,
      subject,
      html: this.getContent(),
      attachments: this.getAttachments(),
      replyTo: this.replyTo,
      cc: this.cc,
      bcc: this.bcc,
      headers: this.headers,
    };

    try {
      this.logger?.log(`[Mailer] Sending email to ${JSON.stringify(this.to)}...`);
      const result = await this.transporter.sendMail(payload);
      this.logger?.log(`[Mailer] Successfully sent to ${JSON.stringify(this.to)}`);
      return result;
    } catch (error) {
      this.logger?.error(`[Mailer] Failed to send to ${JSON.stringify(this.to)}`, error);
      throw error; // Re-throw for Retry / RateLimiter to handle
    }
  }

  /**
   * Sends the email through the configured pipeline:
   * **Retry** wraps **RateLimiter** wraps **executeSend**.
   *
   * @returns The transport result.
   */
  async send() {
    let action = () => this.executeSend();

    // Wrap with rate limiting (if configured)
    if (this.RateLimiter) {
      const coreAction = action;
      action = () => this.RateLimiter!.handle(coreAction);
    }

    // Wrap with retry at the outermost layer (if configured)
    if (this.Retry) {
      return this.Retry.retry(action);
    }

    return action();
  }

  /** Verifies the transport connection. Returns `false` on failure. */
  async verify() {
    try {
      await this.transporter.verify?.();
      return true;
    } catch {
      return false;
    }
  }

  /** Returns the underlying transporter instance. */
  getTransporter() {
    return this.transporter;
  }

  /**
   * Previews a specific registered component.
   * Useful for headless mail builders to render isolated blocks.
   *
   * @param name - The component name to render.
   * @param mockData - Optional mock data for the preview.
   * @returns The formatted component string.
   */
  renderComponent(name: string, mockData?: ObjectOf<T>) {
    return this.Formatter.renderComponent(name, mockData);
  }

  /**
   * Factory method to create a fully configured Mailer from a static config.
   *
   * @param config - Full mailer configuration.
   * @returns A ready-to-use {@link Mailer} instance.
   */
  static from<T = unknown>(config: MailerStatic<T>) {
    const mailer = new Mailer<T>(config.driver, config.options);
    mailer
      .setComponents(config.components ?? {})
      .setData(config.data ?? {})
      .extractOptions(config.options);

    config.retry && mailer.setRetry(config.retry);
    config.rateLimit && mailer.setRateLimit(config.rateLimit);

    return mailer;
  }
}
