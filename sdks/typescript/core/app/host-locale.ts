export const NIMI_HOST_LOCALES = ['en', 'zh'] as const;

export type NimiHostLocale = (typeof NIMI_HOST_LOCALES)[number];

export type NimiHostLocaleResult = Readonly<{
  locale: NimiHostLocale | null;
}>;

export type NimiHostLocaleSource = Readonly<{
  getLocale: () => Promise<unknown>;
}>;

export type ResolveNimiStartupLocaleInput<TLocale extends string = NimiHostLocale> = Readonly<{
  supportedLocales: readonly TLocale[];
  storedLocale?: string | null;
  hostLocale?: string | null;
  navigatorLanguage?: string | null;
  fallback: NoInfer<TLocale>;
}>;

export class NimiHostLocaleParseError extends Error {
  readonly reasonCode = 'SDK_HOST_LOCALE_INVALID' as const;
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'NimiHostLocaleParseError';
    this.field = field;
  }
}

const HOST_LOCALE_SET = new Set<string>(NIMI_HOST_LOCALES);
const LOCALE_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RESOLVE_STARTUP_LOCALE_ALLOWED_KEYS = new Set<string>([
  'supportedLocales',
  'storedLocale',
  'hostLocale',
  'navigatorLanguage',
  'fallback',
]);

export function isNimiHostLocale(value: unknown): value is NimiHostLocale {
  return typeof value === 'string' && HOST_LOCALE_SET.has(value);
}

export function parseNimiHostLocale(value: unknown): NimiHostLocale {
  if (!isNimiHostLocale(value)) {
    throw new NimiHostLocaleParseError(
      'Host locale must be an admitted canonical locale ("en" or "zh").',
      'locale',
    );
  }
  return value;
}

export function parseNimiHostLocaleResult(value: unknown): NimiHostLocaleResult {
  const record = asPlainRecord(value);
  if (!record) {
    throw new NimiHostLocaleParseError('Host locale result must be a plain object.');
  }
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.length !== 1 || ownKeys[0] !== 'locale') {
    throw new NimiHostLocaleParseError('Host locale result must contain only the "locale" field.');
  }
  const rawLocale = record.locale;
  if (rawLocale === null) {
    return Object.freeze({ locale: null });
  }
  return Object.freeze({ locale: parseNimiHostLocale(rawLocale) });
}

export async function readNimiHostLocale(
  source?: NimiHostLocaleSource | null,
): Promise<NimiHostLocale | null> {
  if (source === undefined || source === null) {
    return null;
  }
  if (typeof source !== 'object' || Array.isArray(source) || typeof source.getLocale !== 'function') {
    throw new NimiHostLocaleParseError(
      'Host locale source must provide a getLocale() function.',
      'source',
    );
  }
  const raw = await source.getLocale();
  if (raw === null) {
    return null;
  }
  if (typeof raw === 'string') {
    return parseNimiHostLocale(raw);
  }
  return parseNimiHostLocaleResult(raw).locale;
}

export function resolveNimiStartupLocale<TLocale extends string>(
  input: ResolveNimiStartupLocaleInput<TLocale>,
): TLocale {
  const record = asPlainRecord(input);
  if (!record) {
    throw new NimiHostLocaleParseError('Startup locale input must be a plain object.');
  }
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !RESOLVE_STARTUP_LOCALE_ALLOWED_KEYS.has(key)) {
      throw new NimiHostLocaleParseError(
        `Startup locale input contains unsupported field: ${String(key)}.`,
        typeof key === 'string' ? key : undefined,
      );
    }
  }

  const { supportedLocales, storedLocale, hostLocale, navigatorLanguage, fallback } = input;
  if (!Array.isArray(supportedLocales) || supportedLocales.length === 0) {
    throw new NimiHostLocaleParseError(
      'Startup locale resolution requires a non-empty supportedLocales list.',
      'supportedLocales',
    );
  }

  const supportedEntries: Array<Readonly<{ raw: TLocale; normalized: string; primary: string }>> = [];
  for (const locale of supportedLocales) {
    const normalized = normalizeLocaleTag(locale);
    if (!normalized) {
      throw new NimiHostLocaleParseError(
        'Each supported locale must be a valid non-empty locale tag.',
        'supportedLocales',
      );
    }
    supportedEntries.push({
      raw: locale,
      normalized,
      primary: normalized.split('-')[0] ?? normalized,
    });
  }

  if (typeof fallback !== 'string' || !supportedLocales.includes(fallback)) {
    throw new NimiHostLocaleParseError(
      'Startup locale fallback must be included in supportedLocales.',
      'fallback',
    );
  }

  return (
    matchSupportedLocale(storedLocale, supportedEntries)
    ?? matchSupportedLocale(hostLocale, supportedEntries)
    ?? matchSupportedLocale(navigatorLanguage, supportedEntries)
    ?? fallback
  );
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null;
}

function normalizeLocaleTag(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized || !LOCALE_TAG_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function matchSupportedLocale<TLocale extends string>(
  candidate: unknown,
  supportedEntries: readonly Readonly<{ raw: TLocale; normalized: string; primary: string }>[],
): TLocale | null {
  const normalized = normalizeLocaleTag(candidate);
  if (!normalized) {
    return null;
  }

  for (const entry of supportedEntries) {
    if (entry.normalized === normalized) {
      return entry.raw;
    }
  }

  let bestPrefixMatch: Readonly<{ raw: TLocale; length: number }> | null = null;
  for (const entry of supportedEntries) {
    if (
      normalized.startsWith(`${entry.normalized}-`)
      && (!bestPrefixMatch || entry.normalized.length > bestPrefixMatch.length)
    ) {
      bestPrefixMatch = { raw: entry.raw, length: entry.normalized.length };
    }
  }
  if (bestPrefixMatch) {
    return bestPrefixMatch.raw;
  }

  const primary = normalized.split('-')[0] ?? '';
  for (const entry of supportedEntries) {
    if (entry.primary === primary) {
      return entry.raw;
    }
  }

  return null;
}
