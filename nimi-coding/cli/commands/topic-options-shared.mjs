import { localize } from "../lib/ui.mjs";

export function requireOptionValue(name, next, errorPrefix) {
  if (!next || next.startsWith("--")) {
    return {
      ok: false,
      error: `${localize(
        `${errorPrefix}: ${name} requires a value.`,
        `${errorPrefix}：${name} 需要一个值。`,
      )}\n`,
    };
  }
  return { ok: true };
}

export function validateEnumOption(name, value, allowed, errorPrefix) {
  if (!allowed.includes(value)) {
    return {
      ok: false,
      error: `${localize(
        `${errorPrefix}: unsupported ${name} value ${value}.`,
        `${errorPrefix}：不支持的 ${name} 值 ${value}。`,
      )}\n`,
    };
  }
  return { ok: true };
}
