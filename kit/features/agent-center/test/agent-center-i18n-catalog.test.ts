import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentCenterEnCatalog,
  agentCenterZhCatalog,
  createAgentCenterI18n,
  translateAgentCenter,
} from '../src/headless.js';

const SOURCE_ROOT = join(import.meta.dirname, '..', 'src');
const COMPONENT_ROOT = join(SOURCE_ROOT, 'components');

function componentFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? componentFiles(path)
      : /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

function copyTypeKeys(typeName: string): readonly string[] {
  const source = readFileSync(join(SOURCE_ROOT, 'types.ts'), 'utf8');
  const startMarker = `export type ${typeName} = Partial<{`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf('}>;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(/readonly (\w+)\??:/gu)].map((match) => match[1]);
}

function literalCatalogKeys(): readonly string[] {
  const keys = new Set<string>();
  const pattern = /['"]((?:AgentCenter|ModelConfig)\.[^'"\r\n]+)['"]/gu;
  for (const file of componentFiles(COMPONENT_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (!key.includes('${') && !key.endsWith('.') && key.split('.').length >= 3) keys.add(key);
    }
  }
  return [...keys].sort();
}

describe('Agent Center canonical i18n catalogs', () => {
  it('covers every literal component key in English and ships matching Chinese keys', () => {
    const enKeys = Object.keys(agentCenterEnCatalog).sort();
    const zhKeys = Object.keys(agentCenterZhCatalog).sort();

    expect(enKeys).toHaveLength(385);
    expect(zhKeys).toEqual(enKeys);
    expect(literalCatalogKeys().filter((key) => !(key in agentCenterEnCatalog))).toEqual([]);

    const copyNamespaces = {
      AgentCenterChromeCopy: 'AgentCenter.chrome.',
      AgentCenterProgressCopy: 'AgentCenter.progress.',
      AgentCenterOverviewCopy: 'AgentCenter.overview.',
      AgentCenterAdvancedCopy: 'AgentCenter.advanced.',
      AgentCenterAppearanceCopy: 'AgentCenter.appearance.',
      AgentCenterBehaviorCopy: 'AgentCenter.behavior.',
    } as const;
    for (const [typeName, prefix] of Object.entries(copyNamespaces)) {
      expect(copyTypeKeys(typeName).filter((key) => !(`${prefix}${key}` in agentCenterEnCatalog))).toEqual([]);
    }
  });

  it('resolves host override, active Kit language, then English base', () => {
    const key = 'AgentCenter.cognition.title';
    const english = agentCenterEnCatalog[key];
    const chinese = agentCenterZhCatalog[key];

    expect(translateAgentCenter(undefined, key, english)).toBe(english);
    expect(translateAgentCenter({ language: 'zh-CN', t: (requested) => requested }, key, english)).toBe(chinese);
    expect(translateAgentCenter({
      language: 'zh-CN',
      t: () => 'Host cognition',
    }, key, english)).toBe('Host cognition');
  });

  it('provides a mountable Kit-backed host binding', () => {
    const binding = createAgentCenterI18n({ language: 'zh' });
    expect(binding.t('AgentCenter.section.appearance')).toBe('外观');
    expect(binding.t('AgentCenter.cognition.title')).toBe('认知状态');
  });
});
