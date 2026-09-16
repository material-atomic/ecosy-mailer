/**
 * Every directive the template engine has, rendered without sending.
 *
 * Values are HTML-escaped; `{@raw:path}` is how a value that is already markup
 * gets in. Inside a loop the collection's name refers to the current element.
 */
import { Formatter } from "@ecosy/mailer";

const invoice = new Formatter<unknown>(
  `{@component:header}
   <p>Xin chào {customer.name}</p>
   {@if:customer.vip}<p>Ưu đãi riêng</p>{@else:customer.vip}<p>Cảm ơn bạn</p>{@endif:customer.vip}
   {@if:order.total >= 500}<p>Miễn phí giao hàng</p>{@endif:order.total}
   <ul>{@loop:order.lines}<li>{order.lines:[x]}. {order.lines.sku} — {order.lines.price}</li>{@endloop:order.lines}</ul>
   {@raw:footer.html}`,
  {
    customer: { name: "Nguyễn Văn A", vip: true },
    order: { total: 900, lines: [{ sku: "SP-1", price: 500 }, { sku: "SP-2", price: 400 }] },
    footer: { html: "<hr><small>Shop</small>" },
  },
  {
    components: { header: { content: "<h1>{site.title}</h1>", data: { site: { title: "Shop" } } } },
  },
);

export const html: string = invoice.format();

/** One component on its own, for a preview route. */
export const header: string = invoice.renderComponent("header", { site: { title: "Staging" } });
