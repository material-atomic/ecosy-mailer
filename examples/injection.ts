/**
 * The mailer as an injection token.
 *
 * `Mailer(...)` returns a class constructible with no arguments, which is what
 * `Route({ … })`, `Bootstrap({ … })` and `Inject({ … })` in `@ecosy/next`, or
 * `Schedule({ … })` in `@ecosy/schedule`, each take. One instance per process
 * means the retry and the rate limit are shared — a limit of five a second is
 * five a second, not five per message.
 */
import nodemailer from "nodemailer";
import { Mailer, type LoggerLike } from "@ecosy/mailer";

class AppLogger implements LoggerLike {
  log(message: string) { console.warn(message); }
  warn(message: string) { console.warn(message); }
  error(message: string, ...args: unknown[]) { console.error(message, ...args); }
}

/** Anything constructed with the mailer and handed to `onError`. */
class Alerts {
  raise(subject: string, error: unknown) {
    console.error(`[alert] ${subject}`, error);
  }
}

export const AppMailer = Mailer({
  driver: nodemailer,
  transport: { host: "smtp.example.com", port: 587 },
  defaults: { from: "noreply@example.com" },
  logger: AppLogger,
  inject: { alerts: Alerts },
  onError: (error, message, context) => {
    context.alerts.raise(String(message.subject), error);
  },
});

/** In an app: `class Deps extends Inject({ mailer: AppMailer }) {}` and then `deps.mailer.send(…)`. */
export async function notify(to: string) {
  return new AppMailer().send({ to, subject: "Có việc cần bạn xem", content: "<p>…</p>" });
}
