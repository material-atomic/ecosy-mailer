# Changelog

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
