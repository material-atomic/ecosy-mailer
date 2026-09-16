/* Against dist/, which is what ships. Every example in README.md and in the
   docs page is a test here: 0.1.0 documented a loop and a `>=` comparison that
   its own engine did not render. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Formatter, escapeHtml } = require("../dist/index.js");

const render = (template, data, options) => new Formatter(template, data, options).format();

test("variables, as the docs write them", () => {
  assert.equal(render("{user.name}", { user: { name: "Alice" } }), "Alice");
  assert.equal(render("{order.items.0.price}", { order: { items: [{ price: 12 }] } }), "12");
  assert.equal(render("[{nothing.here}]", {}), "[]", "an unresolved path renders empty");
});

test("values are HTML-escaped, and {@raw:} is how to opt out", () => {
  assert.equal(
    render("<p>{user.name}</p>", { user: { name: '<img src=x onerror="alert(1)">' } }),
    "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>",
  );
  assert.equal(render('<a href="{link}">x</a>', { link: '" onclick="steal()' }), '<a href="&quot; onclick=&quot;steal()">x</a>');
  assert.equal(render("{@raw:body}", { body: "<b>bold</b>" }), "<b>bold</b>");
  assert.equal(render("{body}", { body: "<b>bold</b>" }, { escape: false }), "<b>bold</b>", "escaping can be turned off wholesale");
  assert.equal(escapeHtml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
});

test("conditions, including every comparison the docs list", () => {
  assert.equal(render("{@if:user.isAdmin}Admin{@else:user.isAdmin}Member{@endif:user.isAdmin}", { user: { isAdmin: true } }), "Admin");
  assert.equal(render("{@if:user.isAdmin}Admin{@else:user.isAdmin}Member{@endif:user.isAdmin}", { user: { isAdmin: false } }), "Member");

  const age = (expression) => render(`{@if:user.age ${expression}}yes{@else:user.age}no{@endif:user.age}`, { user: { age: 20 } });
  assert.equal(age(">= 18"), "yes", "the comparison from the README");
  assert.equal(age("> 18"), "yes");
  assert.equal(age("<= 20"), "yes");
  assert.equal(age("< 20"), "no");
  assert.equal(age("=== 20"), "yes");
  assert.equal(age("!== 20"), "no");
  assert.equal(age("== 20"), "yes");
  assert.equal(age("!= 20"), "no");
  assert.equal(render(`{@if:user.role === "admin"}yes{@endif:user.role}`, { user: { role: "admin" } }), "yes");

  assert.equal(render("{@if:items}has{@endif:items}", { items: [] }), "", "an empty array is false");
  assert.equal(render("{@if:flag}yes{@endif:flag}", { flag: "false" }), "", '"false" is false');
});

test("loops render their body — the README's own example", () => {
  assert.equal(
    render("{@loop:items}<li>{items.name} — {items.price}</li>{@endloop:items}", {
      items: [{ name: "A", price: 1 }, { name: "B", price: 2 }],
    }),
    "<li>A — 1</li><li>B — 2</li>",
  );
  assert.equal(render("{@loop:items}[{items:[x]}]{@endloop:items}", { items: ["a", "b"] }), "[0][1]", "the index placeholder");
  assert.equal(render("{@loop:tags}[{tags}]{@endloop:tags}", { tags: ["a", "b"] }), "[a][b]", "a list of scalars");
  assert.equal(render("{@loop:nothing}x{@endloop:nothing}", {}), "", "a path that is not an array renders empty");
});

test("conditions and loops nest, and read the element", () => {
  assert.equal(
    render("{@loop:items}{@if:items.ok}[{items.name}]{@else:items.ok}(bỏ){@endif:items.ok}{@endloop:items}", {
      items: [{ ok: true, name: "A" }, { ok: false, name: "B" }],
    }),
    "[A](bỏ)",
  );
  assert.equal(
    render("{@loop:orders}{orders.id}:{@loop:orders.lines}{orders.lines.sku},{@endloop:orders.lines};{@endloop:orders}", {
      orders: [
        { id: 1, lines: [{ sku: "x" }, { sku: "y" }] },
        { id: 2, lines: [{ sku: "z" }] },
      ],
    }),
    "1:x,y,;2:z,;",
    "a loop inside a loop",
  );
  assert.equal(
    render("{@if:user.age >= 18}{@loop:items}[{items}]{@endloop:items}{@endif:user.age}", { user: { age: 20 }, items: ["a"] }),
    "[a]",
    "a loop inside a condition",
  );
});

test("components, and the data they carry", () => {
  const fmt = new Formatter("{@component:header}{secret}", { secret: "" });
  fmt.setComponents({ header: { content: "<h1>{site.title}</h1>", data: { site: { title: "Shop" } } } });

  assert.equal(fmt.format(), "<h1>Shop</h1>", "component data serves the component");
  assert.equal(fmt.format(), "<h1>Shop</h1>", "…and a second render gives the same");

  const leaky = new Formatter("{@component:head}[{secret}]", {});
  leaky.setComponents({ head: { content: "x", data: { secret: "component's own" } } });
  assert.equal(leaky.format(), "x[]", "component data does not answer paths outside it");

  const nested = new Formatter("{@component:a}", {});
  nested.setComponents({ a: { content: "A{@component:b}", data: {} }, b: { content: "B", data: {} } });
  assert.equal(nested.format(), "AB", "components nest");

  assert.equal(new Formatter("{@component:missing}", {}).format(), "", "an unknown component renders empty");
});

test("a component that includes itself is reported, not a stack overflow", () => {
  const fmt = new Formatter("{@component:a}", {});
  fmt.setComponents({ a: { content: "loop {@component:a}", data: {} } });
  assert.throws(() => fmt.format(), /includes itself/);
});

test("renderComponent, for a preview", () => {
  const fmt = new Formatter("body", { site: { title: "Shop" } });
  fmt.setComponents({ header: { content: "<h1>{site.title}</h1>", data: {} } });

  assert.equal(fmt.renderComponent("header"), "<h1>Shop</h1>");
  assert.equal(fmt.renderComponent("header", { site: { title: "Staging" } }), "<h1>Staging</h1>");
  assert.equal(fmt.renderComponent("nope"), "");
});

test("format(data) does not change the formatter's own data", () => {
  const fmt = new Formatter("{a}{b}", { a: "1" });
  assert.equal(fmt.format({ b: "2" }), "12");
  assert.equal(fmt.format(), "1", "the b from that one render is gone");
});
