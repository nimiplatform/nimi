import process from "node:process";

const SUPPORTED_LOCALES = new Set(["en", "zh"]);

let currentLocale = "en";
let currentColorEnabled = false;
let currentLocalePinned = false;

function detectLocale() {
  const envLocale = process.env.NIMICODING_LANG ?? process.env.LANG ?? "";
  return envLocale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function detectColorEnabled() {
  if (process.env.NO_COLOR) {
    return false;
  }

  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

export function configureCliUi(options = {}) {
  currentLocale = SUPPORTED_LOCALES.has(options.locale) ? options.locale : detectLocale();
  currentColorEnabled = typeof options.colorEnabled === "boolean"
    ? options.colorEnabled
    : detectColorEnabled();
  currentLocalePinned = typeof options.locale === "string" && SUPPORTED_LOCALES.has(options.locale);
}

export function getCliLocale() {
  return currentLocale;
}

export function getCliColorEnabled() {
  return currentColorEnabled;
}

export function isCliLocalePinned() {
  return currentLocalePinned;
}

export function localize(en, zh) {
  return currentLocale === "zh" ? zh : en;
}

export function parseGlobalUiOptions(args) {
  const remainingArgs = [];
  let locale = null;
  let colorEnabled;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--lang") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            "nimicoding refused: --lang requires `en` or `zh`.",
            "nimicoding 已拒绝：`--lang` 需要 `en` 或 `zh`。",
          )}\n`,
        };
      }
      if (!SUPPORTED_LOCALES.has(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding refused: unsupported --lang value ${next}. Use \`en\` or \`zh\`.`,
            `nimicoding 已拒绝：不支持的 --lang 值 ${next}。请使用 \`en\` 或 \`zh\`。`,
          )}\n`,
        };
      }
      locale = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--lang=")) {
      const value = arg.slice("--lang=".length);
      if (!SUPPORTED_LOCALES.has(value)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding refused: unsupported --lang value ${value}. Use \`en\` or \`zh\`.`,
            `nimicoding 已拒绝：不支持的 --lang 值 ${value}。请使用 \`en\` 或 \`zh\`。`,
          )}\n`,
        };
      }
      locale = value;
      continue;
    }

    if (arg === "--color") {
      colorEnabled = true;
      continue;
    }

    if (arg === "--no-color") {
      colorEnabled = false;
      continue;
    }

    remainingArgs.push(arg);
  }

  return {
    ok: true,
    args: remainingArgs,
    locale,
    colorEnabled,
  };
}

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  red: "\u001B[31m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  blue: "\u001B[34m",
  magenta: "\u001B[35m",
  cyan: "\u001B[36m",
};

function applyAnsi(codes, text) {
  if (!currentColorEnabled) {
    return text;
  }

  return `${codes.join("")}${text}${ANSI.reset}`;
}

export function styleHeading(text) {
  return applyAnsi([ANSI.bold, ANSI.cyan], text);
}

export function styleLabel(text) {
  return applyAnsi([ANSI.bold], text);
}

export function styleMuted(text) {
  return applyAnsi([ANSI.dim], text);
}

export function styleCommand(text) {
  return applyAnsi([ANSI.magenta], text);
}

export function styleSuccess(text) {
  return applyAnsi([ANSI.green], text);
}

export function styleWarning(text) {
  return applyAnsi([ANSI.yellow], text);
}

export function styleError(text) {
  return applyAnsi([ANSI.red], text);
}

export function styleStatus(status) {
  if (status === "ok" || status === "complete" || status === "ready") {
    return styleSuccess(status);
  }
  if (status.includes("missing") || status.includes("required") || status === "needs_attention") {
    return styleWarning(status);
  }
  if (status === "fail" || status === "error") {
    return styleError(status);
  }
  return status;
}
