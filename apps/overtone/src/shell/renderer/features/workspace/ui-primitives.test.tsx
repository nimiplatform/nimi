import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { OtButton, OtInput, OtTextarea } from './ui-primitives.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../../../../../..');
const uiPrimitivesPath = path.join(repoRoot, 'apps/overtone/src/shell/renderer/features/workspace/ui-primitives.tsx');
const compositionTablePath = path.join(repoRoot, 'spec/platform/kernel/tables/nimi-ui-compositions.yaml');
const overtoneStylesPath = path.join(repoRoot, 'apps/overtone/src/shell/renderer/styles.css');

function extractComponentBlock(content: string, componentName: string): string {
  const startMatch = content.match(new RegExp(`export\\s+(?:const|function)\\s+${componentName}\\b`, 'u'));
  if (!startMatch || startMatch.index == null) return '';
  const startIndex = startMatch.index;
  const displayNameMatch = content
    .slice(startIndex)
    .match(new RegExp(`${componentName}\\.displayName\\s*=`, 'u'));
  if (displayNameMatch?.index != null) {
    return content.slice(startIndex, startIndex + displayNameMatch.index + displayNameMatch[0].length);
  }
  const nextExportMatch = content.slice(startIndex + 1).match(/\nexport\s+(?:const|function)\s+/u);
  return content.slice(startIndex, nextExportMatch?.index != null ? startIndex + 1 + nextExportMatch.index : content.length);
}

test('overtone thin wrappers render shared nimi primitive classes', () => {
  const html = renderToStaticMarkup(
    <div>
      <OtButton variant="primary">Publish</OtButton>
      <OtButton variant="icon">X</OtButton>
      <OtInput value="hello" onChange={() => {}} />
      <OtTextarea value="world" onChange={() => {}} />
    </div>,
  );

  expect(html).toMatch(/nimi-action/);
  expect(html).toMatch(/nimi-action--icon/);
  expect(html).toMatch(/nimi-field/);
});

test('all exported Overtone ui compositions are registered and thin wrappers stay thin', () => {
  const source = fs.readFileSync(uiPrimitivesPath, 'utf8');
  const registry = fs.readFileSync(compositionTablePath, 'utf8');
  const exportedComponents = [...source.matchAll(/export\s+(?:const|function)\s+(Ot[A-Za-z0-9_]+)/gu)].map((match) => match[1]);

  expect(exportedComponents.length).toBeGreaterThan(0);
  for (const componentName of exportedComponents) {
    expect(registry).toContain(`component: ${componentName}`);
  }

  for (const componentName of ['OtButton', 'OtInput', 'OtTextarea']) {
    const block = extractComponentBlock(source, componentName);
    expect(block).not.toMatch(/\bot-[a-z0-9_-]+\b/u);
    expect(block).not.toMatch(/\b(?:text|bg|border|shadow)-ot-/u);
    expect(block).not.toContain('style={{');
  }
});

test('overtone renderer source does not keep legacy action or field authority classes', () => {
  const styles = fs.readFileSync(overtoneStylesPath, 'utf8');
  const source = fs.readFileSync(uiPrimitivesPath, 'utf8');

  expect(styles).not.toMatch(/\bot-btn-(?:primary|secondary|tertiary|icon)\b/u);
  expect(styles).not.toMatch(/\bot-input(?!-)\b/u);
  expect(source).not.toMatch(/\bot-btn-(?:primary|secondary|tertiary|icon)\b/u);
  expect(source).not.toMatch(/\bot-input(?!-)\b/u);
});
