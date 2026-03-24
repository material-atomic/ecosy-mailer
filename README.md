# @ecosy/mailer

A production-ready email engine with a declarative template system, automatic retry with exponential backoff, and sliding-window rate limiting.

## Features

- **Template engine** — Variables, components, conditionals (with operators), and loops
- **Retry** — Automatic retry with exponential backoff
- **Rate limiting** — Sliding-window with concurrent or serial execution
- **Zero peer dependencies** — Standalone package, no external runtime deps

## Installation

```bash
yarn add @ecosy/mailer
```

## Quick Start

```typescript
import { Mailer } from '@ecosy/mailer';
import nodemailer from 'nodemailer';

const mailer = Mailer.from({
  driver: nodemailer,
  options: {
    host: 'smtp.example.com',
    port: 587,
    auth: { user: 'user', pass: 'pass' },
    from: 'noreply@example.com',
    to: 'user@example.com',
    subject: 'Hello {user.name}',
    content: '<p>Welcome, {user.name}!</p>',
  },
  data: { user: { name: 'Alice' } },
  retry: { retries: 2, delay: 1000 },
  rateLimit: { maxRequests: 5, interval: 1000 },
});

await mailer.send();
```

## Template Syntax

| Directive | Syntax | Description |
|-----------|--------|-------------|
| Variable | `{user.name}` | Deep path interpolation |
| Component | `{@component:header}` | Include named template |
| Condition | `{@if:user.isAdmin}...{@endif:user.isAdmin}` | Truthy check |
| Comparison | `{@if:user.age >= 18}...{@endif:user.age}` | Operator check |
| Else | `{@else:user.isAdmin}` | Else branch |
| Loop | `{@loop:items}...{@endloop:items}` | Array iteration |

## Documentation

Full API reference and guides: **[docs.ecosy.io](https://docs.ecosy.io)**

## License

MIT
