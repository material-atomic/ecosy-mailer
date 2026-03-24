/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Components, ObjectOf } from './types';
import { get } from './get';

/**
 * Template engine for email content.
 * Supports variable interpolation, component inclusion, conditional blocks
 * (with comparison operators), and loop expansion.
 *
 * **Directive syntax**:
 * - Variables: `{user.name}`, `{order.items.0.price}`
 * - Components: `{@component:header}`
 * - Conditions: `{@if:user.isAdmin}...{@else:user.isAdmin}...{@endif:user.isAdmin}`
 * - Conditions with operators: `{@if:user.age >= 18}...{@endif:user.age}`
 * - Loops: `{@loop:items}...{items.name}...{@endloop:items}`
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
  } as const;

  // Pre-compiled regexes — created once and reused
  private static readonly REGEX_COMPONENT = /\{@component:([^}]+)\}/gi;
  private static readonly REGEX_VARIABLE = /\{([a-zA-Z0-9_.-]+)\}/g;
  private static readonly REGEX_IF = /\{@if:\s*([a-zA-Z0-9_.-]+)\s*(?:(==|===|!=|!==|>|>=|<|<=)\s*([^}]+?))?\s*\}([\s\S]*?)(?:\{@else:\1\}([\s\S]*?))?\{@endif:\1\}/gi;

  private formatted: string = "";
  private components: Components = {};

  constructor(private content: string, private data: ObjectOf<T> = {} as ObjectOf<T>) {}

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

  /** Replaces the template content and resets the formatted cache. */
  setContent(content: string) {
    this.content = content;
    this.formatted = "";
    return this;
  }

  // =====================================================================
  // Expression evaluator — safe type coercion from string templates
  // =====================================================================

  /** Parses a comparison value from a template expression string. */
  private parseCompareValue(valStr: string): any {
    valStr = valStr.trim();

    // Quoted strings
    if ((valStr.startsWith("'") && valStr.endsWith("'")) ||
        (valStr.startsWith('"') && valStr.endsWith('"'))) {
      return valStr.slice(1, -1);
    }

    if (valStr === 'true') return true;
    if (valStr === 'false') return false;
    if (valStr === 'null') return null;

    const num = Number(valStr);
    if (!isNaN(num)) return num;

    return valStr;
  }

  // =====================================================================
  // Component resolution (recursive)
  // =====================================================================

  /** Resolves `{@component:name}` directives, merging component data. */
  private solveComponent(content: string): string {
    return content.replace(Formatter.REGEX_COMPONENT, (_, name) => {
      const component = this.components[name.trim()];
      if (!component) return "";
      this.data = { ...this.data, ...component.data } as ObjectOf<T>;
      return this.solveComponent(component.content);
    });
  }

  // =====================================================================
  // Conditional blocks (with operator support)
  // =====================================================================

  /**
   * Resolves `{@if:path}...{@else:path}...{@endif:path}` blocks.
   * Supports comparison operators: `==`, `!=`, `>`, `>=`, `<`, `<=`.
   */
  private solveIf(content: string): string {
    return content.replace(Formatter.REGEX_IF, (match, path, operator, rightStr, ifContent, elseContent) => {
      const leftValue = get(this.data, path);
      let isTruthy = false;

      if (!operator) {
        // No operator — standard truthy/falsy check
        isTruthy = !!leftValue;
        if (Array.isArray(leftValue) && leftValue.length === 0) isTruthy = false;
        if (leftValue === "0" || leftValue === "false") isTruthy = false;
      } else {
        // Comparison with operator
        const rightValue = this.parseCompareValue(rightStr);

        switch (operator) {
          case '==':
          case '===': isTruthy = leftValue == rightValue; break;
          case '!=':
          case '!==': isTruthy = leftValue != rightValue; break;
          case '>': isTruthy = (leftValue as any) > rightValue; break;
          case '>=': isTruthy = (leftValue as any) >= rightValue; break;
          case '<': isTruthy = (leftValue as any) < rightValue; break;
          case '<=': isTruthy = (leftValue as any) <= rightValue; break;
        }
      }

      if (isTruthy) {
        return this.solveIf(ifContent);
      } else {
        return elseContent ? this.solveIf(elseContent) : "";
      }
    });
  }

  // =====================================================================
  // Loop expansion
  // =====================================================================

  /** Resolves `{@loop:path}...{@endloop:path}` blocks with index and property rewriting. */
  private solveLoop(content: string): string {
    const loopPattern = /\{@loop:([a-zA-Z0-9_.-]+)\}([\s\S]*?)\{@endloop:\1\}/gi;

    return content.replace(loopPattern, (match, loopPath, loopContent) => {
      const loopArray = get(this.data, loopPath, []);
      if (!Array.isArray(loopArray) || loopArray.length === 0) return "";

      return loopArray.map((item, index) => {
        let childStr = loopContent;

        // Replace index placeholder {path:[x]} with the numeric index
        const indexRegex = new RegExp(`\\{${loopPath}:\\[x\\]\\}`, 'g');
        childStr = childStr.replace(indexRegex, index.toString());

        // Rewrite property paths: {path.prop} → {path.[index].prop}
        const propRegex = new RegExp(`\\{${loopPath}\\.([a-zA-Z0-9_.-]+)\\}`, 'g');
        childStr = childStr.replace(propRegex, `{${loopPath}.[${index}].$1}`);

        // Rewrite directive paths: {@if:path.prop} → {@if:path.[index].prop}
        const commandRegex = new RegExp(`\\{@(if|else|endif|loop|endloop):\\s*${loopPath}\\.([a-zA-Z0-9_.-]+)`, 'g');
        childStr = childStr.replace(commandRegex, `{@$1:${loopPath}.[${index}].$2`);

        childStr = this.solveLoop(childStr);
        return childStr;
      }).join('');
    });
  }

  // =====================================================================
  // Variable interpolation
  // =====================================================================

  /** Replaces `{path.to.variable}` with resolved values from data. */
  private solveVariables(content: string): string {
    return content.replace(Formatter.REGEX_VARIABLE, (match, path) => {
      const value = get(this.data, path);
      if (value === null || value === undefined || typeof value === "object") return "";
      return String(value);
    });
  }

  // =====================================================================
  // Public API
  // =====================================================================
  /**
   * Renders a specific component by name.
   * Ideal for live previews in mail builder UIs.
   *
   * @param name - The registered component name (e.g. `"header"`).
   * @param overrideData - Optional data to override for this preview.
   * @returns The isolated formatted string of the component.
   */
  renderComponent(name: string, overrideData?: ObjectOf<T>): string {
    const component = this.components[name];
    
    if (!component) {
      return ""; // Return empty string if component not found (safe for UI)
    }

    // Merge priority: global data → component data → preview override data
    const mergedData = { 
      ...this.data, 
      ...component.data, 
      ...overrideData 
    } as ObjectOf<T>;

    // Create an isolated Formatter that only processes this component's content
    const isolatedFormatter = new Formatter<T>(component.content, mergedData);
    
    // Pass component registry to support nested components
    isolatedFormatter.setComponents(this.components);

    return isolatedFormatter.format();
  }

  /**
   * Runs the full formatting pipeline: components → loops → conditionals → variables.
   *
   * @param data - Optional data to merge before formatting.
   * @returns The fully resolved template string.
   */
  format(data?: ObjectOf<T>) {
    if (data) this.data = { ...this.data, ...data };

    let result = this.content;
    result = this.solveComponent(result);
    result = this.solveLoop(result);
    result = this.solveIf(result);
    result = this.solveVariables(result);

    this.formatted = result;
    return this.formatted;
  }
}
