# @ecosy/mailer

An email engine with its own template directives, retry and sliding-window rate
limiting — over any transport. No dependencies.

Documentation: **[docs.ecosy.io/mailer](https://docs.ecosy.io/mailer)**

## Installation

```bash
yarn add @ecosy/mailer
```

## Quick start

```typescript
import nodemailer from "nodemailer";
import { Mailer } from "@ecosy/mailer";

export const AppMailer = Mailer({
  driver: nodemailer,
  transport: { host: "smtp.example.com", port: 587, auth: { user, pass } },
  defaults: { from: "Shop <noreply@example.com>" },
  retry: { retries: 2, delay: 1000 },
  rateLimit: { maxRequests: 5, interval: 1000, mode: "serial" },
});

await new AppMailer().send({
  to: "user@example.com",
  subject: "Welcome, {user.name}",
  content: "<p>Hello {user.name}!</p>",
  text: "Hello {user.name}!",
  data: { user: { name: "Alice" } },
});
```

`Mailer(config)` returns a **class taking no constructor arguments**, so it is an
injection token wherever the ecosy packages take one:

```typescript
class Deps extends Inject({ mailer: AppMailer }) {}
export const { POST } = Route({ mailer: AppMailer }).post((ctx) => ctx.mailer.send({ /* … */ }));
```

One instance holds the transport, the retry and the rate limiter, so a limit of
five a second is five a second. Building a mailer per message — what 0.1.x
showed — gave each message its own budget and limited nothing. Nothing is opened
until the first send.

## Templates

Body, subject and text all go through `Formatter`. Values are **HTML-escaped**;
`{@raw:path}` is how a value that is already markup gets in.

| Directive | Syntax | |
|---|---|---|
| Variable | `{user.name}`, `{order.items.0.price}` | escaped; an unresolved path renders empty |
| Raw value | `{@raw:post.body}` | inserted as written |
| Component | `{@component:header}` | carries its own data |
| Condition | `{@if:user.isAdmin}…{@endif:user.isAdmin}` | the closing tag repeats the **path** |
| Comparison | `{@if:user.age >= 18}…{@endif:user.age}` | `===` `!==` `==` `!=` `>=` `<=` `>` `<` |
| Else | `{@else:user.isAdmin}` | |
| Loop | `{@loop:items}…{items.name}…{@endloop:items}` | the collection's name is the current element |
| Loop index | `{items:[x]}` | 0-based |

Inside a loop the body is an ordinary template — variables, conditions and
further loops all read from the element:

```
{@loop:order.lines}
  <li>{order.lines:[x]}. {order.lines.sku}
    {@if:order.lines.price >= 500}<b>deal</b>{@endif:order.lines.price}</li>
{@endloop:order.lines}
```

A component's data serves that component only:

```typescript
Mailer({
  components: { header: { content: "<h1>{site.title}</h1>", data: { site: { title: "Shop" } } } },
});
```

## Rendering without sending

```typescript
const mailer = new AppMailer();

mailer.render({ subject: "Hi {user.name}", content: "…", data });  // { subject, html, text? }
mailer.renderComponent("header", { site: { title: "Staging" } });
```

## Attachments

```typescript
await new AppMailer().send({
  to,
  content: "<p>Your invoice</p>",
  attachments: ["/var/app/invoices/2026-09.pdf", { filename: "logo.png", path: "/assets/logo.png", cid: "logo" }],
});
```

A string is a file path. Everything else is Nodemailer's attachment shape, `cid`
included, for an image the template references as `<img src="cid:logo">`.

## Retry and rate limiting

```typescript
interface RetryOptions { retries?: number; delay?: number; backoffFactor?: number }      // 1, 3000ms, 1
interface RateLimitOptions { maxRequests?: number; interval?: number; mode?: "serial" | "concurrent" }
```

`retries: 2` means up to three attempts. The limiter is a sliding window held in
memory, per mailer instance — two processes each get their own budget. Both work
on their own, too:

```typescript
import { RateLimiter, Retry } from "@ecosy/mailer";

await new Retry({ retries: 3 }).retry(() => doSomething());
await new RateLimiter({ maxRequests: 5, interval: 1000 }).handle(() => send(payload));
```

## Logging and failures

```typescript
Mailer({
  logger: AppLogger,            // a LoggerLike, or a class that builds one
  inject: { alerts: Alerts },   // constructed once with the mailer
  onError: (error, message, context) => context.alerts.raise(message.subject, error),
});
```

`send` logs at `log` on success, `error` on failure, and `debug` while building
the payload — `console` and `@ecosy/logger` both fit. `MAILER_LOGGING=false`
silences it without a code change. `onError` runs after the last retry; the error
is rethrown either way.

## Examples

Type-checked as part of the build, in [`examples/`](./examples): `quick-start.ts`,
`templates.ts`, `injection.ts`, `pieces.ts`.

## Upgrading from 0.1.x

`Mailer.from({ driver, options, data, retry, rateLimit })` is gone. Configure a
mailer once, and pass each message to `send`:

```diff
-const mailer = Mailer.from({
-  driver: nodemailer,
-  options: { host, port, auth, from, to, subject, content },
-  data,
-  retry: { retries: 2, delay: 1000 },
-});
-await mailer.send();
+const AppMailer = Mailer({
+  driver: nodemailer,
+  transport: { host, port, auth },
+  defaults: { from },
+  retry: { retries: 2, delay: 1000 },
+});
+await new AppMailer().send({ to, subject, content, data });
```

Also in 0.2.0: template values are escaped by default (`{@raw:path}` opts out),
loops and the `>=`, `<=`, `===`, `!==` comparisons render at all, a string
attachment is attached rather than dropped, and the package loads under `require`
again.

## License

MIT
