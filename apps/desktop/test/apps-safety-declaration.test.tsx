/**
 * Publisher safety declaration display proof.
 *
 * Renders the declaration section, the confirmation summary and the update
 * diff through the real i18n instance and asserts the declaration is shown as
 * declared with its source, absence reads as undeclared (never an empty risk
 * list), absent notices and markings are shown as facts, and the diff reports
 * only changed facts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AppSafetyDeclaration } from '@nimiplatform/sdk/runtime/wire-types';

(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import {
  AppsSafetyDeclarationDiff,
  AppsSafetyDeclarationSection,
  AppsSafetyDeclarationSummary,
} from '../src/shell/renderer/features/apps/apps-safety-declaration';

function declaration(overrides: Partial<AppSafetyDeclaration> = {}): AppSafetyDeclaration {
  return {
    intendedAudience: 'general',
    contentDescriptors: [],
    aiDirectInteraction: true,
    aiInteractionNotice: 'absent',
    aiRiskFeatures: [],
    aiSubjectNotice: 'not-applicable',
    aiOutputs: [{ modality: 'text', exposure: 'exportable', publicationControl: 'not-applicable', inProductNotice: 'absent', exportVisibleMarking: 'absent', machineReadableMarking: 'absent' }],
    publisherDirectExternalNetwork: false,
    telemetry: [],
    thirdPartyAccount: 'none',
    userContentSharing: 'none',
    commercialFeatures: [],
    sensitiveDataCategories: [],
    highImpactDecisionUses: [],
    ...overrides,
  };
}

test('the declaration section shows declared facts with their source and never a safety verdict', async () => {
  await initI18n();
  await changeLocale('en');
  const markup = renderToStaticMarkup(<AppsSafetyDeclarationSection declaration={declaration({ contentDescriptors: ['violence', 'strong-language'] })} source="registry" version="1.2.0" />);
  assert.ok(markup.includes('data-testid="apps-safety-declaration"'));
  assert.ok(markup.includes('data-declared="true"'));
  assert.ok(markup.includes('data-declaration-source="registry"'));
  assert.ok(markup.includes('Declared by the publisher for version 1.2.0'), 'the source names the exact version');
  assert.ok(markup.includes('Nimi does not certify these statements'));
  assert.ok(markup.includes('General audience'));
  assert.ok(markup.includes('Violence, Strong language'));
  assert.ok(markup.includes('People interact with AI directly'));
  assert.ok(markup.includes('AI output · Text'));
  assert.ok(markup.includes('can be saved or exported'));
  assert.ok(markup.includes('visible export marking: absent'), 'an absent marking is shown as a fact');
  assert.ok(markup.includes('not provided on every supported path'), 'absent is explained as not uniformly provided');
  assert.ok(markup.includes('No publisher-controlled network access declared'));
  assert.equal(/verified safe|certified safe|guaranteed|approved as safe/iu.test(markup), false, 'no safety verdict wording');
  await changeLocale('zh');
});

test('an undeclared version reads as undeclared for Registry and local sources and local packages stay usable', async () => {
  await initI18n();
  await changeLocale('en');
  const registry = renderToStaticMarkup(<AppsSafetyDeclarationSection declaration={null} source="registry" version="1.0.0" />);
  assert.ok(registry.includes('data-declared="false"'));
  assert.ok(registry.includes('has not declared audience, content, AI output or data facts'));
  assert.equal(registry.includes('<dl'), false, 'no empty fact list is rendered for an undeclared version');
  const local = renderToStaticMarkup(<AppsSafetyDeclarationSection declaration={null} source="local" version="0.1.0" />);
  assert.ok(local.includes('no publisher safety declaration. It remains usable'));
  const localDeclared = renderToStaticMarkup(<AppsSafetyDeclarationSection declaration={declaration()} source="local" version="0.1.0" compact />);
  assert.ok(localDeclared.includes('The Registry has not reviewed it'), 'a local declaration is unreviewed');
  await changeLocale('zh');
});

test('the confirmation summary stays short and the update diff reports only changed facts', async () => {
  await initI18n();
  await changeLocale('en');
  const summary = renderToStaticMarkup(<AppsSafetyDeclarationSummary declaration={declaration({ telemetry: ['crash-diagnostics'], thirdPartyAccount: 'optional' })} source="registry" version="1.2.0" />);
  assert.ok(summary.includes('data-testid="apps-safety-declaration-summary"'));
  assert.ok(summary.includes('Text (can be saved or exported)'));
  assert.ok(summary.includes('Crash diagnostics, Third-party account: Optional'));
  assert.equal(summary.includes('machine-readable marking'), false, 'the summary omits per-output marking detail');

  const same = renderToStaticMarkup(<AppsSafetyDeclarationDiff before={declaration()} after={declaration()} afterVersion="1.3.0" />);
  assert.ok(same.includes('data-changes="0"'));
  assert.ok(same.includes('No declaration changes'));
  const changed = renderToStaticMarkup(<AppsSafetyDeclarationDiff before={declaration()} after={declaration({ contentDescriptors: ['gambling'], intendedAudience: 'adult' })} afterVersion="1.3.0" />);
  assert.ok(changed.includes('data-changes="2"'));
  assert.ok(changed.includes('Declaration changes in 1.3.0'));
  assert.ok(changed.includes('General audience'));
  assert.ok(changed.includes('Adults'));
  assert.ok(changed.includes('Gambling'));
  assert.equal(changed.includes('AI output · Text'), false, 'unchanged facts are not listed');
  const fromUndeclared = renderToStaticMarkup(<AppsSafetyDeclarationDiff before={null} after={declaration()} afterVersion="1.3.0" />);
  assert.ok(fromUndeclared.includes('Undeclared'));
  const bothUndeclared = renderToStaticMarkup(<AppsSafetyDeclarationDiff before={null} after={null} afterVersion="1.3.0" />);
  assert.ok(bothUndeclared.includes('Neither the installed version nor this update carries'));
  await changeLocale('zh');
});

test('the shown declaration always belongs to the shown version and a read failure is not undeclared', async () => {
  const { resolveSafetyDeclarationState } = await import('../src/shell/renderer/features/apps/apps-safety-declaration');
  const installed = declaration({ intendedAudience: 'general' });
  const catalogNext = { version: '1.1.0', safetyDeclaration: declaration({ intendedAudience: 'adult' }) };
  const catalogSame = { version: '1.0.0', safetyDeclaration: declaration({ intendedAudience: 'teen' }) };
  assert.deepEqual(resolveSafetyDeclarationState({ installedVersion: '1.0.0', installedInfo: { version: '1.0.0', safetyDeclaration: installed }, installedInfoError: null, catalog: catalogNext }),
    { status: 'loaded', declaration: installed, version: '1.0.0' }, 'the installed snapshot wins over a newer Catalog target');
  assert.deepEqual(resolveSafetyDeclarationState({ installedVersion: '1.0.0', installedInfo: undefined, installedInfoError: undefined, catalog: catalogNext }),
    { status: 'loading' }, 'a newer Catalog declaration never substitutes for the installed version');
  assert.deepEqual(resolveSafetyDeclarationState({ installedVersion: '1.0.0', installedInfo: undefined, installedInfoError: undefined, catalog: catalogSame }),
    { status: 'loaded', declaration: catalogSame.safetyDeclaration, version: '1.0.0' }, 'the same release may substitute while loading');
  assert.deepEqual(resolveSafetyDeclarationState({ installedVersion: '1.0.0', installedInfo: null, installedInfoError: 'read failed', catalog: catalogSame }),
    { status: 'unavailable' }, 'a failed read is unavailable, not undeclared');
  assert.deepEqual(resolveSafetyDeclarationState({ installedVersion: '1.0.0', installedInfo: { version: '1.0.0' }, installedInfoError: null, catalog: catalogNext }),
    { status: 'loaded', declaration: null, version: '1.0.0' }, 'an installed snapshot without a declaration is undeclared for that version');
  assert.deepEqual(resolveSafetyDeclarationState({ installedVersion: null, installedInfo: undefined, installedInfoError: undefined, catalog: catalogNext }),
    { status: 'loaded', declaration: catalogNext.safetyDeclaration, version: '1.1.0' }, 'a not-yet-installed target shows the admitted target declaration');
  await initI18n();
  await changeLocale('en');
  const unavailable = renderToStaticMarkup(<AppsSafetyDeclarationSection declaration={null} source="registry" version={null} state="unavailable" />);
  assert.ok(unavailable.includes('data-testid="apps-safety-declaration-unavailable"'));
  assert.equal(unavailable.includes('has not declared'), false);
  const loading = renderToStaticMarkup(<AppsSafetyDeclarationSection declaration={null} source="registry" version={null} state="loading" />);
  assert.ok(loading.includes('data-declaration-state="loading"'));
  await changeLocale('zh');
});
