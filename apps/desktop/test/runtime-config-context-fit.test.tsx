import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { changeLocale, initI18n, productionDesktopI18n } from '../src/shell/renderer/i18n';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract';
import { SetupTaskPlanReview } from '../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view';
import { formatContextTokens } from '../src/shell/renderer/features/runtime-config/runtime-capability-presentation';
import type { RuntimeSetupPreparationPlan } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-runner';

const plan = {
  reuse: [{ slotId: 'main.gguf', label: 'Main model', modelAssetId: 'asset-1' }],
  acquire: [], awaitingChoice: [], unavailable: [], components: [], options: [],
  environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false,
} satisfies RuntimeSetupPreparationPlan;
const reduced = { authoredContextSize: 262144, recommendedContextSize: 98304, recommendedOptions: { contextSize: 98304 } };
const automatic = { authoredContextSize: 262144, recommendedContextSize: 262144, recommendedOptions: {} };

function review(contextPreview?: typeof reduced): string {
  const bindings = { app: { commands: {} }, sdk: {} } as DesktopCanonicalRendererBindings;
  return renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={productionDesktopI18n}>
      <DesktopRendererBindingProvider bindings={bindings}>
        <SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} {...(contextPreview ? { contextPreview } : {})} />
      </DesktopRendererBindingProvider>
    </DesktopI18nResourceProvider>,
  );
}

test('context sizes read the way model capacity is written', () => {
  assert.equal(formatContextTokens(262144), '256K');
  assert.equal(formatContextTokens(98304), '96K');
  assert.equal(formatContextTokens(32768), '32K');
});

test('the setup review states the context it writes and why Runtime reduced it', async () => {
  await initI18n();
  await changeLocale('en');
  const reducedMarkup = review(reduced);
  assert.match(reducedMarkup, />Context<[\s\S]*>96K tokens</);
  assert.match(reducedMarkup, /Reduced from 256K to fit this device&#x27;s memory/);
  // The Driver option key never reaches the product surface.
  assert.doesNotMatch(reducedMarkup, /contextSize/);
  const automaticMarkup = review(automatic);
  assert.match(automaticMarkup, /Up to 256K tokens/);
  assert.doesNotMatch(automaticMarkup, /Reduced from/);
  assert.doesNotMatch(review(), /runtime-setup-context/);

  await changeLocale('zh');
  const zh = review(reduced);
  assert.match(zh, />上下文<[\s\S]*>96K</);
  assert.match(zh, /为适配本机内存，已从 256K 缩短/);
  assert.match(review(automatic), /最长 256K/);
  await changeLocale('en');
});
