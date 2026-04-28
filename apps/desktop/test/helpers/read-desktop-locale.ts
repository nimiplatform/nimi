/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LOCALES_ROOT = resolve(import.meta.dirname, '../../src/shell/renderer/locales');

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function namespaceFromLocaleFileName(fileName: string): string {
  return fileName.slice(0, -'.json'.length).replace(/^\d+-/, '');
}

export function readDesktopLocale(locale: string): Record<string, any> {
  const flatPath = join(LOCALES_ROOT, `${locale}.json`);
  if (existsSync(flatPath)) {
    return readJson(flatPath) as Record<string, any>;
  }

  const localeDir = join(LOCALES_ROOT, locale);
  const bundle: Record<string, any> = {};
  for (const entry of readdirSync(localeDir, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    bundle[namespaceFromLocaleFileName(entry.name)] = readJson(join(localeDir, entry.name));
  }
  return bundle;
}

export function readDesktopLocaleSource(locale: string): string {
  return JSON.stringify(readDesktopLocale(locale), null, 2);
}
