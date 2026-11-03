import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoCloudSetup } from '../src/landing/components/demo-cloud-setup.js';
import { DemoSessionContext, useHeroDemoSession } from '../src/landing/components/hero-demo-context.js';
import { HeroDemoSessionProvider } from '../src/landing/components/hero-demo-session.js';
import { authOptions, cloudProviders, cloudSetupTarget, modelsFor, newCloudExample, ownerOptions } from '../src/landing/content/demo-cloud-data.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('the provider picker includes services outside the sample connections and respects their credential modes', () => {
  const sample = newCloudExample();
  assert.ok(cloudProviders.length > sample.connections.length);
  assert.ok(cloudProviders.some(p => p.provider === 'azure' && p.requiresExplicitEndpoint));
  assert.ok(!cloudProviders.some(p => p.provider === 'local'));
  assert.deepEqual(authOptions('openai_chatgpt_plan').map(option => option.authMode), ['oauth_managed']);
  assert.ok(authOptions('anthropic').some(option => option.authMode === 'api_key'));
});

test('a sample configuration refers to a bundled model and an eligible consumer without requiring a connection check', () => {
  const sample = newCloudExample();
  const use = sample.uses[0]!;
  const connection = sample.connections.find(c => c.id === use.connectionId)!;
  assert.ok(modelsFor(connection.provider).some(model => model.id === use.model && model.capabilities.includes(use.capability)));
  assert.ok(ownerOptions(use.capability, (_zh, en) => en).some(owner => owner.id === use.owner));
  const unchecked = sample.connections.find(c => c.status === 'unchecked')!;
  assert.ok(modelsFor(unchecked.provider).length > 0);
  assert.ok(!ownerOptions('audio.transcribe', (_zh, en) => en).some(owner => owner.id === 'nimi.desktop'));
});

test('revisiting a cloud setup shows its saved model unless that consumer has a pending edit', async () => {
  const { demo } = (await loadLandingContent('en')).hero;
  const cloud = newCloudExample();
  const chat = cloud.uses[0]!;
  const models = modelsFor('deepseek').filter(model => model.capabilities.includes(chat.capability));
  const other = models.find(model => model.id !== chat.model)!;
  const parent = { ...chat, owner: 'nimi.parentos', model: other.id };
  cloud.uses.push(parent);
  const target = cloudSetupTarget(parent);
  function Setup() {
    const session = useHeroDemoSession();
    return createElement(DemoSessionContext.Provider, { value: { ...session, cloud } },
      createElement(DemoCloudSetup, { demo, target }));
  }
  const render = () => renderToStaticMarkup(createElement(HeroDemoSessionProvider, { demo, children: createElement(Setup) }));
  const saved = render();
  assert.match(saved, /Save for ParentOS/);
  assert.ok(saved.includes(`Saved model: ${other.label}`));

  cloud.drafts[target] = { ...parent, model: chat.model };
  const edited = render();
  const pendingModel = models.find(model => model.id === chat.model)!;
  assert.ok(edited.includes(`Selected model: ${pendingModel.label}`));
  assert.ok(!edited.includes('Saved model:'));
});
