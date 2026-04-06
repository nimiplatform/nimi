// i18n locale completeness and initialization tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(testDir, '..', 'src', 'renderer', 'locales');

const en = JSON.parse(readFileSync(path.join(localesDir, 'en.json'), 'utf-8'));
const zh = JSON.parse(readFileSync(path.join(localesDir, 'zh.json'), 'utf-8'));

// ── Helpers ─────────────────────────────────────────────────────────────

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatKeys(v as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

// ── Key parity ──────────────────────────────────────────────────────────

describe('i18n — locale key parity', () => {
  const enKeys = flatKeys(en);
  const zhKeys = flatKeys(zh);

  it('en.json has keys', () => {
    assert.ok(enKeys.length > 0, 'en.json must have at least one key');
  });

  it('zh.json has keys', () => {
    assert.ok(zhKeys.length > 0, 'zh.json must have at least one key');
  });

  it('every en key exists in zh', () => {
    const zhSet = new Set(zhKeys);
    const missing = enKeys.filter((k) => !zhSet.has(k));
    assert.deepEqual(missing, [], `zh.json is missing keys: ${missing.join(', ')}`);
  });

  it('every zh key exists in en', () => {
    const enSet = new Set(enKeys);
    const extra = zhKeys.filter((k) => !enSet.has(k));
    assert.deepEqual(extra, [], `zh.json has extra keys not in en: ${extra.join(', ')}`);
  });

  it('en and zh have identical key sets', () => {
    assert.deepEqual(enKeys, zhKeys);
  });
});

// ── Value completeness ──────────────────────────────────────────────────

describe('i18n — no empty translations', () => {
  const enKeys = flatKeys(en);

  function resolve(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  it('no en value is empty string', () => {
    for (const key of enKeys) {
      const value = resolve(en, key);
      assert.ok(
        typeof value === 'string' && value.length > 0,
        `en key "${key}" must be a non-empty string, got: ${JSON.stringify(value)}`,
      );
    }
  });

  it('no zh value is empty string', () => {
    for (const key of enKeys) {
      const value = resolve(zh, key);
      assert.ok(
        typeof value === 'string' && value.length > 0,
        `zh key "${key}" must be a non-empty string, got: ${JSON.stringify(value)}`,
      );
    }
  });
});

// ── Interpolation variables ─────────────────────────────────────────────

describe('i18n — interpolation variable consistency', () => {
  const enKeys = flatKeys(en);

  function resolve(obj: Record<string, unknown>, key: string): string {
    const parts = key.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }
    return typeof current === 'string' ? current : '';
  }

  function extractVars(text: string): string[] {
    return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  }

  it('interpolation variables match between en and zh', () => {
    for (const key of enKeys) {
      const enValue = resolve(en, key);
      const zhValue = resolve(zh, key);
      const enVars = extractVars(enValue);
      const zhVars = extractVars(zhValue);
      assert.deepEqual(
        enVars,
        zhVars,
        `key "${key}": en vars ${JSON.stringify(enVars)} ≠ zh vars ${JSON.stringify(zhVars)}`,
      );
    }
  });
});

// ── Namespace structure ─────────────────────────────────────────────────

describe('i18n — namespace structure', () => {
  const expectedNamespaces = [
    'app', 'status', 'agent', 'chat', 'degradation', 'voice', 'video', 'live2d',
  ];

  it('en.json has all required top-level namespaces', () => {
    for (const ns of expectedNamespaces) {
      assert.ok(ns in en, `en.json must have namespace "${ns}"`);
    }
  });

  it('zh.json has all required top-level namespaces', () => {
    for (const ns of expectedNamespaces) {
      assert.ok(ns in zh, `zh.json must have namespace "${ns}"`);
    }
  });
});
