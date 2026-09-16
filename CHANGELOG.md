# Changelog

## 0.2.0 (2026-09-16)

### Breaking Changes

- **`Mailer` is now a factory**: `Mailer(config)` returns a class taking no constructor arguments — an injection token for `Route({ … })`, `Inject({ … })`, `Bootstrap({ … })` and `Schedule({ … })`. One instance holds the transport, the retry and the rate limiter, so a limit applies across sends; `Mailer.from(…)` built one mailer per message and gave each its own budget. Messages are passed to `send(message)` instead of being set on the instance, so concurrent sends cannot race.
- **Template values are HTML-escaped by default**: `{@raw:path}` inserts a value as written, and `escape: false` turns escaping off wholesale. Before this, a name holding `<img src=x onerror=…>` reached the body as markup.
- **`Attachment.path`** is `string` (was `string | Url`), and `SendOptions.attachments` holds `Attachment[]` — a bare file path is accepted on a message and converted.

### Bug Fixes

- **CommonJS**: the package declared `"type": "module"` while shipping CommonJS `.js` files, so `require("@ecosy/mailer")` failed with "require is not defined in ES module scope". The declaration is gone.
- **Loops rendered nothing usable**: `{@loop:items}{items.name}{@endloop:items}` produced the literal `{items.[0].name}`. The body is now rendered against a context where the collection's name is bound to the element, so variables, conditions and nested loops all work inside a loop — the example in the README and in the docs included.
- **`>=`, `<=`, `===` and `!==` compared wrongly**: the operator alternation matched `>` first and left `= 18` as the value, so `{@if:user.age >= 18}` was false for 20.
- **A string attachment was dropped silently**: it was built as `{ raw: { path } }`, which the transport ignores. It is `{ path }` now, and the MIME carries the file.
- **A component including itself** overflowed the stack; it is reported by name, with a depth limit.
- **A component's data leaked**: it was merged into the formatter's own data, answering paths elsewhere in the template and outliving the render. It now serves that component only.
- **`format(data)`** no longer mutates the formatter's data.
- **Build from a clean clone failed**: `@rollup/plugin-typescript` needs `tslib`, which was not a devDependency. `check-dist` now fails the build if a helper import reaches `dist`.
- **The published build dropped every `console` call**, warnings and errors included; only `log`, `info` and `debug` go now.
- **`@ecosy/mailer/package.json`** resolves; it threw `ERR_PACKAGE_PATH_NOT_EXPORTED` before.

### Features

- **`text`**: a plain-text alternative, templated like the body but never escaped.
- **`render` / `renderComponent`** on the mailer, for a preview route or a snapshot test, and `raw: true` to send a template as written.
- **`logger`** accepts a class token as well as an instance; **`inject`** builds tokens once with the mailer and hands them to **`onError`**, which runs after the last retry.
- **`DriverLike`** takes Nodemailer directly — its overloaded `createTransport` needed a cast at every call site before.
- **Tests and examples**: 23 tests against `dist`, attachments checked through a real Nodemailer transport, and `examples/` type-checked as part of the build. Every example in the README is a test.

## 0.1.0 (2026-03-25)

### Features

- **Formatter**: Declarative template engine with variable interpolation, component inclusion, conditional blocks (with comparison operators), and loop expansion
- **Formatter**: `renderComponent` for isolated component previews (ideal for mail builder UIs)
- **Mailer**: Fluent email builder with transport abstraction, attachment handling, and header merging
- **Mailer**: `LoggerLike` integration for structured send pipeline diagnostics
- **Mailer**: Environment-based log suppression via `MAILER_LOGGING=false`
- **Retry**: Automatic retry with configurable exponential backoff
- **RateLimiter**: Sliding-window rate limiting with concurrent or serial execution
- **Types**: `DriverLike`, `TransporterLike`, `LoggerLike` interfaces for transport and logger abstraction
- Zero peer dependencies — fully standalone package
