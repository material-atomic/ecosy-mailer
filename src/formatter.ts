import type { Components, ObjectOf } from './types';
import { get } from './get';

/** Options for {@link Formatter}. */
export interface FormatterOptions {
  /**
   * HTML-escape every value a `{path}` puts in. Default `true`.
   *
   * A template is written by the application; the data usually is not — a name,
   * a subject line, anything a person typed. Unescaped, `<img src=x onerror=…>`
   * in a name lands in the body as markup. `{@raw:path}` puts a value in as it
   * is, for the places that mean to.
   */
  escape?: boolean | undefined;
  /** Named components for `{@component:name}`. */
  components?: Components | undefined;
  /** How deep components may nest before it is called a loop. Default 20. */
  maxDepth?: number | undefined;
}

const REGEX = {
  component: /\{@component:([^}]+)\}/g,
  /* `===` and `!==` first: `==` would match their first two characters and
     leave the third on the value — which is how `>=` compared against "= 18". */
  condition:
    /\{@if:\s*([a-zA-Z0-9_.-]+)\s*(?:(===|!==|==|!=|>=|<=|>|<)\s*([^}]*?))?\s*\}([\s\S]*?)(?:\{@else:\1\}([\s\S]*?))?\{@endif:\1\}/g,
  raw: /\{@raw:([a-zA-Z0-9_.-]+)\}/g,
  variable: /\{([a-zA-Z0-9_.-]+)\}/g,
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The five characters that change the meaning of HTML around them. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A copy of `data` with `path` bound to `value`, the objects along the way cloned. */
function bind(data: ObjectOf<unknown>, path: string, value: unknown): ObjectOf<unknown> {
  const keys = path.split(".").filter(Boolean);
  const root: ObjectOf<unknown> = { ...data };
  let node = root;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const current = node[key];
    node[key] = current && typeof current === "object" ? { ...(current as ObjectOf<unknown>) } : {};
    node = node[key] as ObjectOf<unknown>;
  }

  node[keys[keys.length - 1]!] = value;
  return root;
}

/**
 * Template engine for email content.
 *
 * **Directives**
 * - Variables: `{user.name}`, `{order.items.0.price}` — HTML-escaped
 * - Raw values: `{@raw:post.body}` — inserted as written
 * - Components: `{@component:header}`
 * - Conditions: `{@if:user.isAdmin}…{@else:user.isAdmin}…{@endif:user.isAdmin}`
 * - Comparisons: `{@if:user.age >= 18}…{@endif:user.age}` — `===`, `!==`, `==`,
 *   `!=`, `>=`, `<=`, `>`, `<`
 * - Loops: `{@loop:items}…{items.name}…{@endloop:items}`, with `{items:[x]}`
 *   for the index
 *
 * Inside a loop the collection's own name refers to the current element, so a
 * loop body is an ordinary template: variables, conditions and further loops all
 * read from the element. That is done by rendering the body against a data
 * context where the path is bound to the element — not by rewriting the text of
 * the paths, which is what left `{items.[0].name}` in the output before 0.2.0.
 *
 * @example
 * ```ts
 * const fmt = new Formatter('<p>Hello {user.name}</p>', { user: { name: 'Alice' } });
 * fmt.format(); // "<p>Hello Alice</p>"
 * ```
 */
export class Formatter<T = unknown> {
  /** Recognized directive keywords. */
  static readonly KEYWORDS = {
    LOOP: ['loop', 'endloop'],
    COMPONENT: ['component'],
    IF: ['if', 'else', 'endif'],
    RAW: ['raw'],
  } as const;

  private components: Components;
  private escape: boolean;
  private maxDepth: number;

  constructor(
    private content: string,
    private data: ObjectOf<T> = {} as ObjectOf<T>,
    options: FormatterOptions = {},
  ) {
    this.components = options.components ? { ...options.components } : {};
    this.escape = options.escape ?? true;
    this.maxDepth = options.maxDepth ?? 20;
  }

  /** Replaces the data context. */
  setData(data: ObjectOf<T>) {
    this.data = data;
    return this;
  }

  /** Registers named components for `{@component:name}` resolution. */
  setComponents(components: Components) {
    this.components = { ...components };
    return this;
  }

  /** Replaces the template content. */
  setContent(content: string) {
    this.content = content;
    return this;
  }

  /** Changes escaping and nesting depth. Components are replaced when given. */
  setOptions(options: FormatterOptions) {
    if (options.components) this.components = { ...options.components };
    if (options.escape !== undefined) this.escape = options.escape;
    if (options.maxDepth !== undefined) this.maxDepth = options.maxDepth;
    return this;
  }

  /** Parses the right-hand side of a comparison. */
  private parseCompareValue(text: string): unknown {
    const value = text.trim();

    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      return value.slice(1, -1);
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (value === "") return "";

    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }

  private compare(left: unknown, operator: string, right: unknown): boolean {
    switch (operator) {
      case "===": return left === right;
      case "!==": return left !== right;
      /* Loose on purpose: a template compares a string from the data with a
         number written in the template — `{@if:user.age == 18}`. `===` is there
         for the caller who wants the strict one. */
      case "==": return left == right;
      case "!=": return left != right;
      case ">": return (left as number) > (right as number);
      case ">=": return (left as number) >= (right as number);
      case "<": return (left as number) < (right as number);
      case "<=": return (left as number) <= (right as number);
      default: return false;
    }
  }

  /** Truthiness as a template means it: an empty array, `"0"` and `"false"` are false. */
  private truthy(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (value === "0" || value === "false") return false;
    return Boolean(value);
  }

  private solveComponents(content: string, data: ObjectOf<unknown>, depth: number): string {
    return content.replace(REGEX.component, (_, rawName: string) => {
      const name = rawName.trim();
      const component = this.components[name];
      if (!component) return "";

      if (depth >= this.maxDepth) {
        throw new Error(
          `[Formatter] Component "${name}" is still nesting ${this.maxDepth} levels down — it includes itself, ` +
            `directly or through another component.`,
        );
      }

      /* The component's data is merged for its own content only. Merging it into
         the shared context — what happened before 0.2.0 — let a component's data
         answer paths in the rest of the template, and outlive the render. */
      return this.render(component.content, { ...data, ...component.data }, depth + 1);
    });
  }

  private solveLoops(content: string, data: ObjectOf<unknown>, depth: number): string {
    const pattern = /\{@loop:([a-zA-Z0-9_.-]+)\}([\s\S]*?)\{@endloop:\1\}/g;

    return content.replace(pattern, (_, path: string, body: string) => {
      const items = get(data, path);
      if (!Array.isArray(items) || items.length === 0) return "";

      const indexPattern = new RegExp(`\\{${escapeRegExp(path)}:\\[x\\]\\}`, "g");

      return items
        .map((item, index) => this.render(body.replace(indexPattern, String(index)), bind(data, path, item), depth + 1))
        .join("");
    });
  }

  private solveConditions(content: string, data: ObjectOf<unknown>, depth: number): string {
    return content.replace(
      REGEX.condition,
      (_, path: string, operator: string | undefined, right: string | undefined, whenTrue: string, whenFalse: string | undefined) => {
        const left = get(data, path);
        const holds = operator
          ? this.compare(left, operator, this.parseCompareValue(right ?? ""))
          : this.truthy(left);
        const branch = holds ? whenTrue : whenFalse;
        return branch ? this.render(branch, data, depth + 1) : "";
      },
    );
  }

  private solveValues(content: string, data: ObjectOf<unknown>): string {
    const write = (value: unknown, escape: boolean) => {
      if (value === null || value === undefined || typeof value === "object" || typeof value === "function") return "";
      const text = String(value);
      return escape ? escapeHtml(text) : text;
    };

    return content
      .replace(REGEX.raw, (_, path: string) => write(get(data, path), false))
      .replace(REGEX.variable, (_, path: string) => write(get(data, path), this.escape));
  }

  /** One pass of the pipeline over `content` with `data` as its context. */
  private render(content: string, data: ObjectOf<unknown>, depth: number): string {
    if (depth >= this.maxDepth) {
      throw new Error(`[Formatter] Template nested past ${this.maxDepth} levels — a component or loop includes itself.`);
    }

    let result = this.solveComponents(content, data, depth);
    result = this.solveLoops(result, data, depth);
    result = this.solveConditions(result, data, depth);
    return this.solveValues(result, data);
  }

  /**
   * Renders one registered component on its own — for a preview route, or a
   * snapshot test.
   *
   * @param name - The registered component name.
   * @param overrideData - Data laid over the formatter's and the component's own.
   * @returns The rendered component, or `""` when there is no such component.
   */
  renderComponent(name: string, overrideData?: ObjectOf<T>): string {
    const component = this.components[name];
    if (!component) return "";

    return this.render(component.content, { ...this.data, ...component.data, ...overrideData }, 0);
  }

  /**
   * Renders the template.
   *
   * @param data - Merged over the formatter's data for this render only; the
   * formatter's own data is left as it was.
   * @returns The rendered string.
   */
  format(data?: ObjectOf<T>) {
    return this.render(this.content, data ? { ...this.data, ...data } : { ...this.data }, 0);
  }
}
