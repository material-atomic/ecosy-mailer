/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Safely retrieves a nested value from an object using a dot/bracket path.
 * Returns `defaultValue` only when the resolved value is `undefined` —
 * falsy values like `null`, `0`, `false`, and `""` are returned as-is.
 *
 * @param data - The source object to traverse.
 * @param path - Dot-notation string (`"a.b.c"`), bracket-notation (`"a[0].b"`), or an array of keys.
 * @param defaultValue - Value returned when the path resolves to `undefined`.
 * @returns The resolved value, or `defaultValue` if not found.
 *
 * @internal Inlined copy from `@ecosy/core` to keep this package standalone.
 */
export function get<Type = unknown>(
  data: unknown,
  path: string | string[],
  defaultValue?: Type
): Type {
  if (data === null || data === undefined) {
    return defaultValue as Type;
  }

  const keys = Array.isArray(path)
    ? path
    : path
        .replace(/\[(\d+)]/g, '.$1')
        .split('.')
        .filter(Boolean);

  if (keys.length === 0) {
    return data as Type;
  }

  let result: any = data;

  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue as Type;
    }
    result = result[key];
  }

  return result === undefined ? (defaultValue as Type) : (result as Type);
}
