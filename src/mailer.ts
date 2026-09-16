import { Formatter } from './formatter';
import { Retry, type RetryOptions } from './retry';
import { RateLimiter, type RateLimitOptions } from './rate-limiter';
import type {
  Attachment,
  ClassType,
  Components,
  DriverLike,
  InjectMap,
  Injected,
  LoggerLike,
  MailerAddress,
  MailerFrom,
  ObjectOf,
  SendOptions,
  TransporterLike,
  TransportOptions,
} from './types';

/** Address and header fields a message carries, and a mailer can default. */
export interface MessageEnvelope {
  to?: MailerAddress | undefined;
  from?: MailerFrom | undefined;
  cc?: MailerAddress | undefined;
  bcc?: MailerAddress | undefined;
  /** Defaults to `from` when neither the message nor the mailer sets it. */
  replyTo?: MailerAddress | undefined;
  headers?: ObjectOf<string> | undefined;
  attachments?: Array<string | Attachment> | undefined;
}

/** One message: an envelope, its templates, and the data they read. */
export interface Message<Data = unknown> extends MessageEnvelope {
  /** Subject template. */
  subject?: string | undefined;
  /** HTML body template. */
  content?: string | undefined;
  /** Plain-text alternative. Worth sending: a message with no text part reads as bulk to some filters. */
  text?: string | undefined;
  /** Data for this message, merged over the mailer's. */
  data?: ObjectOf<Data> | undefined;
  /** Components for this message, merged over the mailer's. */
  components?: Components | undefined;
  /** Send the templates as they are, with no directives resolved. */
  raw?: boolean | undefined;
}

/** What {@link Mailer} renders before handing anything to the transport. */
export interface RenderedMessage {
  subject: string;
  html: string;
  text?: string | undefined;
}

/** Configuration for the {@link Mailer} factory. */
export interface MailerConfig<Data = unknown, Injects extends InjectMap = InjectMap> {
  /** The transport library — anything with `createTransport`, Nodemailer included. */
  driver: DriverLike;
  /** Connection options, handed to `createTransport` untouched. */
  transport?: TransportOptions | undefined;
  /** Envelope fields and templates every message starts from. */
  defaults?: (MessageEnvelope & { subject?: string | undefined; content?: string | undefined; text?: string | undefined }) | undefined;
  /** Named template components. */
  components?: Components | undefined;
  /** Data every message's own data is merged over. */
  data?: ObjectOf<Data> | undefined;
  /** Retry, shared by every send through this mailer. */
  retry?: RetryOptions | undefined;
  /** Rate limit, shared by every send through this mailer — which is what makes it a limit. */
  rateLimit?: RateLimitOptions | undefined;
  /** HTML-escape template values. Default `true`. See {@link Formatter}. */
  escape?: boolean | undefined;
  /** A logger, or a class to construct one from — the injection token an app already has. */
  logger?: LoggerLike | ClassType<LoggerLike> | undefined;
  /** Tokens constructed once with the mailer and handed to {@link MailerConfig.onError}. */
  inject?: Injects | undefined;
  /** Called when a send has failed for good — after the last retry. The error is rethrown either way. */
  onError?: ((error: unknown, message: Message<Data>, context: Injected<Injects>) => void) | undefined;
}

/** What the class {@link Mailer} returns builds. */
export interface MailerLike<Data = unknown> {
  /** Renders and sends one message. */
  send(message?: Message<Data>): Promise<unknown>;
  /** Renders a message without sending it — for a preview route, or a snapshot test. */
  render(message?: Message<Data>): RenderedMessage;
  /** Renders one registered component on its own. */
  renderComponent(name: string, data?: ObjectOf<Data>): string;
  /** `true` when the transport verifies, `false` on any failure. */
  verify(): Promise<boolean>;
  /** The underlying transport, for what this API does not cover. */
  transporter(): TransporterLike;
}

function isClass(value: unknown): value is ClassType<LoggerLike> {
  return typeof value === "function";
}

/**
 * Builds a mailer class from one configuration.
 *
 * The class takes no constructor arguments, so it is an injection token like
 * any other: `Route({ mailer: AppMailer })`, `class Deps extends Inject({ mailer: AppMailer })`.
 * One instance holds the transport, the retry and the rate limiter, so a limit
 * of five a second is five a second — configuring a mailer per message, as this
 * package's own README used to show, gave every message a fresh budget and
 * limited nothing.
 *
 * Nothing is built until the first send: constructing the token opens no socket.
 *
 * @example
 * ```ts
 * import nodemailer from "nodemailer";
 * import { Mailer } from "@ecosy/mailer";
 *
 * export const AppMailer = Mailer({
 *   driver: nodemailer,
 *   transport: { host, port, secure, auth: { user, pass } },
 *   defaults: { from: "Shop <noreply@example.com>" },
 *   retry: { retries: 2, delay: 1000 },
 *   rateLimit: { maxRequests: 5, interval: 1000, mode: "serial" },
 *   logger: AppLogger,
 * });
 *
 * await new AppMailer().send({
 *   to: "user@example.com",
 *   subject: "Welcome, {user.name}",
 *   content: "<p>Hello {user.name}!</p>",
 *   data: { user: { name: "Alice" } },
 * });
 * ```
 *
 * @template Data - The shape of the template data.
 * @param config - Transport, defaults, templates and policies.
 * @returns A class constructible with no arguments.
 */
export function Mailer<Data = unknown, Injects extends InjectMap = InjectMap>(
  config: MailerConfig<Data, Injects>,
): ClassType<MailerLike<Data>> {
  if (!config?.driver || typeof config.driver.createTransport !== "function") {
    throw new TypeError("[Mailer] `driver` must be a mail library with createTransport — nodemailer, for one.");
  }

  return class MailerClient implements MailerLike<Data> {
    private transport?: TransporterLike;
    private loggerInstance?: LoggerLike | undefined;
    private readonly context: Injected<Injects>;
    private readonly retry: Retry | undefined;
    private readonly limiter: RateLimiter | undefined;

    constructor() {
      const context = {} as Record<string, unknown>;
      for (const [key, Token] of Object.entries(config.inject ?? {})) context[key] = new Token();
      this.context = context as Injected<Injects>;

      this.retry = config.retry ? new Retry(config.retry) : undefined;
      this.limiter = config.rateLimit ? new RateLimiter(config.rateLimit) : undefined;
    }

    /** Built on first use, so a token can be constructed anywhere. */
    transporter(): TransporterLike {
      if (!this.transport) this.transport = config.driver.createTransport({ ...config.transport });
      return this.transport;
    }

    /**
     * The logger, or nothing when `MAILER_LOGGING=false` — the switch for an
     * environment that wants the pipeline quiet without changing code.
     */
    private get logger(): LoggerLike | undefined {
      const env = typeof process !== "undefined" ? process.env : undefined;
      if (env?.MAILER_LOGGING?.toLowerCase() === "false") return undefined;

      if (!this.loggerInstance && config.logger) {
        this.loggerInstance = isClass(config.logger) ? new config.logger() : config.logger;
      }
      return this.loggerInstance;
    }

    private formatter(message: Message<Data>, content: string): Formatter<Data> {
      return new Formatter<Data>(content, { ...config.data, ...message.data } as ObjectOf<Data>, {
        components: { ...config.components, ...message.components },
        escape: config.escape,
      });
    }

    render(message: Message<Data> = {}): RenderedMessage {
      const subject = message.subject ?? config.defaults?.subject ?? "";
      const html = message.content ?? config.defaults?.content ?? "";
      const text = message.text ?? config.defaults?.text;

      if (message.raw) {
        return { subject, html, ...(text === undefined ? {} : { text }) };
      }

      return {
        subject: this.formatter(message, subject).format(),
        html: this.formatter(message, html).format(),
        ...(text === undefined ? {} : { text: this.formatter(message, text).setOptions({ escape: false }).format() }),
      };
    }

    renderComponent(name: string, data?: ObjectOf<Data>): string {
      return this.formatter({ data } as Message<Data>, "").renderComponent(name, data);
    }

    /** Attachments as the transport wants them: a string is a file path, not raw MIME. */
    private attachments(message: Message<Data>): Attachment[] | undefined {
      const list = message.attachments ?? config.defaults?.attachments;
      if (!list?.length) return undefined;

      const headers = { ...config.defaults?.headers, ...message.headers };

      return list.map((attachment) =>
        typeof attachment === "string"
          ? { path: attachment, headers }
          : { ...attachment, headers: attachment.headers ?? headers },
      );
    }

    private payload(message: Message<Data>): SendOptions {
      const rendered = this.render(message);
      const from = message.from ?? config.defaults?.from;
      const to = message.to ?? config.defaults?.to;

      if (!to) {
        throw new TypeError("[Mailer] send() needs a recipient: give the message a `to`, or the mailer a `defaults.to`.");
      }

      return {
        from,
        to,
        cc: message.cc ?? config.defaults?.cc,
        bcc: message.bcc ?? config.defaults?.bcc,
        replyTo: message.replyTo ?? config.defaults?.replyTo ?? from,
        subject: rendered.subject,
        html: rendered.html,
        ...(rendered.text === undefined ? {} : { text: rendered.text }),
        headers: { ...config.defaults?.headers, ...message.headers },
        attachments: this.attachments(message),
      };
    }

    async send(message: Message<Data> = {}): Promise<unknown> {
      const payload = this.payload(message);
      const logger = this.logger;

      const attempt = async () => {
        logger?.debug?.(`[Mailer] Sending "${payload.subject}" to ${JSON.stringify(payload.to)}`);
        const result = await this.transporter().sendMail(payload);
        logger?.log(`[Mailer] Sent "${payload.subject}" to ${JSON.stringify(payload.to)}`);
        return result;
      };

      /* Retry outside the limiter: every attempt takes a slot, so a retry storm
         is shaped by the same budget as ordinary sends. */
      const limited = this.limiter ? () => this.limiter!.handle(attempt) : attempt;

      try {
        return this.retry ? await this.retry.retry(limited) : await limited();
      } catch (error) {
        logger?.error(`[Mailer] Failed to send "${payload.subject}" to ${JSON.stringify(payload.to)}`, error);
        config.onError?.(error, message, this.context);
        throw error;
      }
    }

    async verify(): Promise<boolean> {
      try {
        const transporter = this.transporter();
        if (!transporter.verify) return true;
        await transporter.verify();
        return true;
      } catch (error) {
        this.logger?.error("[Mailer] Transport did not verify", error);
        return false;
      }
    }
  };
}
