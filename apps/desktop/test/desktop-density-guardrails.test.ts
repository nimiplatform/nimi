import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const desktopDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopDir, '../..');
const rendererDir = path.join(desktopDir, 'src/shell/renderer');
const rendererSurfaceRegistryPath = path.join(
  repoRoot,
  '.nimi/spec/desktop/kernel/tables/renderer-design-surfaces.yaml',
);

const REQUIRED_COMPACT_OPERATIONAL_MODULES = [
  'main.tsx',
  'app-shell/routes/app-routes.tsx',
  'first-run/first-run-wizard-chrome.tsx',
  'first-run/product-control-workflow.tsx',
  'features/apps/apps-panel.tsx',
  'features/developer/developer-tools-panel.tsx',
  'features/runtime-config/runtime-config-panel-view.tsx',
  'features/runtime-config/runtime-config-page-overview.tsx',
  'features/runtime-config/runtime-config-page-catalog.tsx',
  'features/settings/settings-panel-body.tsx',
  'features/settings/settings-wallet-sections.tsx',
  'features/settings/settings-account-panel.tsx',
  'features/support/support-panel.tsx',
  'features/support/support-degraded-entry.tsx',
] as const;

const BANNED_OPERATIONAL_DENSITY_CLASSES = [
  'text-[30px]',
  'text-3xl',
  'text-4xl',
  'text-5xl',
  'rounded-3xl',
] as const;

const BANNED_COMPACT_SURFACE_PATTERNS = [
  { pattern: /@keyframes\s+nimi-(?:entry|bootstrap)-[A-Za-z0-9-]*(?:pulse|spin|float|dot)/u, label: 'decorative status motion keyframes' },
  { pattern: /\bnimi-(?:entry|bootstrap)-[A-Za-z0-9-]*(?:pulse|spin|float|dot)[A-Za-z0-9-]*\b/u, label: 'decorative status motion class' },
  { pattern: /repeat:\s*Infinity/u, label: 'looping decorative status motion' },
  { pattern: /tone="hero"/u, label: 'hero tone' },
  { pattern: /material="glass-thick"/u, label: 'glass-thick material' },
  { pattern: /\b(?:py-10|py-11|p-9|px-10)\b/u, label: 'oversized operational padding' },
] as const;

type RendererSurfaceRegistry = {
  surfaces?: Array<{
    module?: string;
    density_mode?: string;
  }>;
};

function readRenderer(relativePath: string): string {
  return readFileSync(path.join(rendererDir, relativePath), 'utf8');
}

function compactSurfaceModules(): string[] {
  const registry = YAML.parse(readFileSync(rendererSurfaceRegistryPath, 'utf8')) as RendererSurfaceRegistry;
  const modules = (registry.surfaces ?? [])
    .filter((surface) => surface.density_mode === 'compact')
    .map((surface) => String(surface.module ?? '').trim())
    .filter(Boolean);
  return [...new Set(modules)].sort();
}

test('desktop operational surfaces are registered as compact density', () => {
  const compactModules = new Set(compactSurfaceModules());
  const missing = REQUIRED_COMPACT_OPERATIONAL_MODULES.filter((module) => !compactModules.has(module));
  assert.deepEqual(missing, []);
});

test('desktop compact surfaces do not use expressive density classes', () => {
  const violations: string[] = [];
  for (const filePath of compactSurfaceModules()) {
    const source = readRenderer(filePath);
    for (const className of BANNED_OPERATIONAL_DENSITY_CLASSES) {
      if (source.includes(className)) {
        violations.push(`${filePath}: ${className}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('desktop compact surfaces do not use hero tone or decorative status motion', () => {
  const violations: string[] = [];
  for (const filePath of compactSurfaceModules()) {
    const source = readRenderer(filePath);
    for (const { pattern, label } of BANNED_COMPACT_SURFACE_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${filePath}: ${label}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
