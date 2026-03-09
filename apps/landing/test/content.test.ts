import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDING_CONTENT } from '../src/content/landing-content.js';

test('content includes install, SDK tabs, and mods in both locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = LANDING_CONTENT[locale];
    assert.ok(content.install.terminalSteps.length >= 3);
    assert.equal(content.install.terminalSteps[1]?.command, 'nimi start');
    assert.ok(content.install.terminalSteps.every((step) => !step.command.includes('nimi serve')));
    assert.match(content.install.terminalSteps[2]?.command || '', /nimi run ".+"$/);
    assert.ok(!content.install.terminalSteps[2]?.command.includes('--yes'));
    assert.ok(content.sdk.tabs.length >= 3);
    assert.ok(content.mods.items.length >= 6);
    assert.ok(content.desktop.features.length >= 4);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.install.sdkSnippet.includes('@nimiplatform/sdk'));
  }
});
