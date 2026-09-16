/**
 * The shortest thing that sends: one configured mailer, one message.
 *
 * `Mailer(config)` returns a class, so it is also an injection token — see
 * `injection.ts`. Nothing is opened until the first send.
 */
import nodemailer from "nodemailer";
import { Mailer } from "@ecosy/mailer";

export const AppMailer = Mailer({
  driver: nodemailer,
  transport: { host: "smtp.example.com", port: 587, auth: { user: "user", pass: "pass" } },
  defaults: { from: "Shop <noreply@example.com>" },
  retry: { retries: 2, delay: 1000 },
  rateLimit: { maxRequests: 5, interval: 1000, mode: "serial" },
});

export async function welcome(to: string, name: string) {
  const mailer = new AppMailer();

  return mailer.send({
    to,
    subject: "Welcome, {user.name}",
    content: "<p>Hello {user.name}!</p>",
    text: "Hello {user.name}!",
    data: { user: { name } },
  });
}
