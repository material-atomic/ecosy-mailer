/* The factory, against dist/. Attachments are checked through a real Nodemailer
   transport, because what matters is the MIME it produces: 0.1.0 built a shape
   Nodemailer ignored, and dropped every file attachment without an error. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { Mailer } = require("../dist/index.js");
const nodemailer = require("nodemailer");

/** A driver that records payloads instead of sending them. */
function recorder() {
  const sent = [];
  let created = 0;
  return {
    sent,
    created: () => created,
    driver: {
      createTransport(options) {
        created++;
        return {
          options,
          async sendMail(payload) {
            sent.push(payload);
            return { accepted: payload.to };
          },
          async verify() {
            return true;
          },
        };
      },
    },
  };
}

const stream = { createTransport: () => nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" }) };

test("the factory returns a class an injection map can hold", async () => {
  const { driver, sent } = recorder();
  const AppMailer = Mailer({ driver, transport: { host: "smtp.test", port: 587 }, defaults: { from: "shop@test" } });

  assert.equal(typeof AppMailer, "function");
  assert.equal(AppMailer.length, 0, "constructible with no arguments");

  const mailer = new AppMailer();
  await mailer.send({ to: "a@test", subject: "Hello {user.name}", content: "<p>Hi {user.name}</p>", data: { user: { name: "An" } } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Hello An");
  assert.equal(sent[0].html, "<p>Hi An</p>");
  assert.equal(sent[0].from, "shop@test");
  assert.equal(sent[0].replyTo, "shop@test", "replyTo falls back to from");
});

test("the transport is built on first use, not when the token is constructed", async () => {
  const { driver, created } = recorder();
  const AppMailer = Mailer({ driver, transport: { host: "h" } });

  const mailer = new AppMailer();
  assert.equal(created(), 0, "constructing the token opened nothing");

  await mailer.send({ to: "a@test", content: "x" });
  await mailer.send({ to: "b@test", content: "x" });
  assert.equal(created(), 1, "and one transport serves every send");
});

test("defaults and per-message fields, merged one way", async () => {
  const { driver, sent } = recorder();
  const AppMailer = Mailer({
    driver,
    defaults: { from: "shop@test", to: "fallback@test", headers: { "x-app": "shop" }, subject: "Mặc định", content: "<p>mặc định</p>" },
    data: { site: { name: "Shop" } },
  });
  const mailer = new AppMailer();

  await mailer.send();
  assert.deepEqual(
    { to: sent[0].to, subject: sent[0].subject, html: sent[0].html, headers: sent[0].headers },
    { to: "fallback@test", subject: "Mặc định", html: "<p>mặc định</p>", headers: { "x-app": "shop" } },
  );

  await mailer.send({ to: "b@test", subject: "{site.name}", content: "<p>{site.name}</p>", headers: { "x-run": "2" } });
  assert.deepEqual(
    { to: sent[1].to, subject: sent[1].subject, headers: sent[1].headers },
    { to: "b@test", subject: "Shop", headers: { "x-app": "shop", "x-run": "2" } },
  );
});

test("a message with no recipient is refused by name", async () => {
  const { driver } = recorder();
  const mailer = new (Mailer({ driver }))();
  await assert.rejects(() => mailer.send({ content: "x" }), /needs a recipient/);
});

test("render and renderComponent do not send", async () => {
  const { driver, sent } = recorder();
  const AppMailer = Mailer({
    driver,
    components: { header: { content: "<h1>{site.title}</h1>", data: { site: { title: "Shop" } } } },
    data: { user: { name: "An" } },
  });
  const mailer = new AppMailer();

  assert.deepEqual(mailer.render({ subject: "Chào {user.name}", content: "{@component:header}<p>{user.name}</p>" }), {
    subject: "Chào An",
    html: "<h1>Shop</h1><p>An</p>",
  });
  assert.equal(mailer.renderComponent("header", { site: { title: "Staging" } }), "<h1>Staging</h1>");
  assert.equal(sent.length, 0);
});

test("raw: true sends the templates as written", async () => {
  const { driver, sent } = recorder();
  const mailer = new (Mailer({ driver }))();
  await mailer.send({ to: "a@test", subject: "{not.a.path}", content: "<p>{literal}</p>", raw: true });
  assert.equal(sent[0].subject, "{not.a.path}");
  assert.equal(sent[0].html, "<p>{literal}</p>");
});

test("a text part rides along, and is not HTML-escaped", async () => {
  const { driver, sent } = recorder();
  const mailer = new (Mailer({ driver }))();
  await mailer.send({ to: "a@test", content: "<p>{user.name}</p>", text: "Chào {user.name} <3", data: { user: { name: "An" } } });
  assert.equal(sent[0].text, "Chào An <3");
  assert.equal(sent[0].html, "<p>An</p>");
});

test("a string attachment is a file path, and Nodemailer attaches it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ecosy-mailer-"));
  const file = join(dir, "hoa-don.txt");
  writeFileSync(file, "nội dung");

  const mailer = new (Mailer({ driver: stream, defaults: { from: "a@test" } }))();
  const info = await mailer.send({ to: "b@test", subject: "s", content: "<p>hi</p>", attachments: [file] });
  const mime = info.message.toString();

  assert.match(mime, /Content-Disposition: attachment/);
  assert.match(mime, /hoa-don/);
  assert.match(Buffer.from(mime.split("hoa-don.txt")[1] ?? "", "utf8").toString(), /./);
});

test("the rate limit is the mailer's, so it holds across sends", async () => {
  const { driver } = recorder();
  const mailer = new (Mailer({ driver, rateLimit: { maxRequests: 2, interval: 300 }, defaults: { from: "a@test" } }))();

  const start = Date.now();
  const stamps = [];
  await Promise.all(
    [...Array(6)].map(() => mailer.send({ to: "b@test", content: "x" }).then(() => stamps.push(Date.now() - start))),
  );

  stamps.sort((a, b) => a - b);
  assert.ok(stamps[2] >= 250, `the third send waited for a slot (${stamps.join(", ")})`);
  assert.ok(stamps[4] >= 550, `and the fifth for another (${stamps.join(", ")})`);
});

test("retry wraps a send, and the failure carries the transport's error", async () => {
  let attempts = 0;
  const driver = {
    createTransport: () => ({
      async sendMail() {
        attempts++;
        if (attempts < 3) throw new Error("mail server bận");
        return { ok: true };
      },
    }),
  };
  const mailer = new (Mailer({ driver, retry: { retries: 2, delay: 5 }, defaults: { from: "a@test" } }))();

  assert.deepEqual(await mailer.send({ to: "b@test", content: "x" }), { ok: true });
  assert.equal(attempts, 3);

  attempts = 10;
  const always = new (Mailer({
    driver: { createTransport: () => ({ sendMail: async () => { throw new Error("từ chối"); } }) },
    retry: { retries: 1, delay: 5 },
    defaults: { from: "a@test" },
  }))();
  await assert.rejects(() => always.send({ to: "b@test", content: "x" }), /Failed after 2 attempts.*từ chối/);
});

test("onError sees the message and the injected context; the error still throws", async () => {
  class Audit {
    constructor() { this.seen = []; }
  }
  const failures = [];
  const mailer = new (Mailer({
    driver: { createTransport: () => ({ sendMail: async () => { throw new Error("hỏng"); } }) },
    inject: { audit: Audit },
    onError: (error, message, context) => {
      context.audit.seen.push(message.to);
      failures.push([String(error.message), context.audit instanceof Audit]);
    },
    defaults: { from: "a@test" },
  }))();

  await assert.rejects(() => mailer.send({ to: "b@test", content: "x" }), /hỏng/);
  assert.deepEqual(failures, [["hỏng", true]]);
});

test("a logger can be a class token, and MAILER_LOGGING=false silences it", async () => {
  const lines = [];
  class AppLogger {
    log(message) { lines.push(`log:${message}`); }
    warn(message) { lines.push(`warn:${message}`); }
    error(message) { lines.push(`error:${message}`); }
    debug(message) { lines.push(`debug:${message}`); }
  }
  const { driver } = recorder();
  const mailer = new (Mailer({ driver, logger: AppLogger, defaults: { from: "a@test" } }))();

  await mailer.send({ to: "b@test", content: "x" });
  assert.ok(lines.some((line) => line.startsWith("log:")), "the send was logged");

  const previous = process.env.MAILER_LOGGING;
  process.env.MAILER_LOGGING = "false";
  lines.length = 0;
  try {
    await mailer.send({ to: "b@test", content: "x" });
    assert.deepEqual(lines, []);
  } finally {
    if (previous === undefined) delete process.env.MAILER_LOGGING;
    else process.env.MAILER_LOGGING = previous;
  }
});

test("verify reports what the transport said", async () => {
  const { driver } = recorder();
  assert.equal(await new (Mailer({ driver }))().verify(), true);

  const refusing = Mailer({ driver: { createTransport: () => ({ sendMail: async () => ({}), verify: async () => { throw new Error("sai mật khẩu"); } }) } });
  assert.equal(await new refusing().verify(), false);

  const noVerify = Mailer({ driver: { createTransport: () => ({ sendMail: async () => ({}) }) } });
  assert.equal(await new noVerify().verify(), true, "a transport with no verify counts as not-failed");
});

test("a driver that is not one is refused when the mailer is configured", () => {
  assert.throws(() => Mailer({ driver: {} }), /createTransport/);
  assert.throws(() => Mailer({}), /createTransport/);
});
