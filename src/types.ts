/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Readable } from 'stream';
import type { Url } from 'url';

/** Generic record type for plain objects. */
export type ObjectOf<T> = Record<string, T>;

/** A named template component with its own data context. */
export interface Component {
  /** The component's HTML/text content (may contain placeholders). */
  content: string;
  /** Data context merged into the parent Formatter's data during resolution. */
  data: ObjectOf<unknown>;
}

/** Map of component names to their definitions. */
export type Components = ObjectOf<Component>;

/** Flexible header format supported by most Node.js mailer transports. */
type Headers =
  | { [key: string]: string | string[] | { prepared: boolean; value: string } }
  | Array<{ key: string; value: string }>;

/** An email attachment descriptor. */
export interface Attachment {
  /** Filename to use for the attachment. Set `false` to hide the filename. */
  filename?: string | false;
  /** Content-ID for inline/embedded images (e.g. `<image@cid>`). */
  cid?: string;
  /** Content encoding (e.g. `"base64"`). */
  encoding?: string;
  /** MIME content type. */
  contentType?: string;
  /** Transfer encoding. Set `false` to disable. */
  contentTransferEncoding?: '7bit' | 'base64' | 'quoted-printable' | false;
  /** Disposition: `"attachment"` (download) or `"inline"` (embed). */
  contentDisposition?: 'attachment' | 'inline';
  /** Custom headers for this attachment. */
  headers?: Headers;
  /** Attachment content as a string, Buffer, or Readable stream. */
  content?: string | Buffer | Readable;
  /** File path or URL to read the attachment from. */
  path?: string | Url;
  /** Raw attachment content (bypasses encoding). */
  raw?:
    | string
    | Buffer
    | Readable
    | {
        content?: string | Buffer | Readable | undefined;
        path?: string | Url | undefined;
      };
}

/** An email address with an optional display name. */
export interface MailAddress {
  /** Display name (e.g. `"John Doe"`). */
  name: string;
  /** Email address (e.g. `"john@example.com"`). */
  address: string;
}

/** Accepted formats for a "from" address. */
export type MailerFrom = string | MailAddress;

/** Accepted formats for any address field (single or array). */
export type MailerAddress = MailerFrom | Array<MailerFrom>;

/** Options passed to the transporter's `sendMail` method. */
export interface SendOptions {
  /** Recipient address(es). */
  to?: MailerAddress;
  /** Sender address. */
  from?: MailerFrom;
  /** Email subject line. */
  subject?: string;
  /** CC address(es). */
  cc?: MailerAddress;
  /** BCC address(es). */
  bcc?: MailerAddress;
  /** Reply-to address(es). */
  replyTo?: MailerAddress;
  /** List of attachments (file paths or {@link Attachment} objects). */
  attachments?: Array<string | Attachment>;
  /** Custom email headers. */
  headers?: ObjectOf<string>;
  /** HTML body content. */
  html?: string;
}

/**
 * Minimal interface a mail transport must implement.
 * Compatible with Nodemailer's `Transporter`.
 */
export interface TransporterLike {
  /** Sends an email and returns the transport result. */
  sendMail(mail: SendOptions): Promise<unknown>;
  /** Verifies the transport connection. Optional (e.g. SendGrid has no verify). */
  verify?(): Promise<boolean | any>;
}

/** Connection options for creating a transport. */
export interface TransportOptions {
  /** SMTP host. */
  host?: string;
  /** SMTP port. */
  port?: number;
  /** Authentication credentials. */
  auth?: any;
  /** Use TLS. */
  secure?: boolean;
  /** Connection URL (alternative to host/port/auth). */
  url?: string;
}

/** Factory interface for creating a {@link TransporterLike} from options. */
export interface DriverLike {
  /** Creates a transporter instance from the given options. */
  createTransport(options: TransportOptions): TransporterLike;
}

/**
 * Minimal logger interface for structured logging.
 * Compatible with `console`, Winston, Pino, and similar loggers.
 */
export interface LoggerLike {
  /** Logs an informational message. */
  log(message: string, ...args: unknown[]): void;
  /** Logs a warning message. */
  warn(message: string, ...args: unknown[]): void;
  /** Logs an error message. */
  error(message: string, ...args: unknown[]): void;
  /** Logs a debug message. Optional — not all loggers support this. */
  debug?(message: string, ...args: unknown[]): void;
  /** Logs a verbose/trace message. Optional. */
  verbose?(message: string, ...args: unknown[]): void;
}
