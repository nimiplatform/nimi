import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialDemoSection,
  reduceDemoNavigation,
  type DemoNavigation,
} from '../src/landing/content/demo-navigation.js';

const home = (): DemoNavigation => ({ entries: [{ surface: 'home' }], position: 0 });

test('landing deep links enter the matching Home tour and ordinary navigation takes over', () => {
  assert.equal(initialDemoSection('#apps'), 1);
  assert.equal(initialDemoSection(''), 0);
  const index = initialDemoSection('#worlds');
  let state = reduceDemoNavigation(home(), { type: 'enter-section', index });
  assert.deepEqual(state.entries[state.position], { surface: 'explore' });
  state = reduceDemoNavigation(state, { type: 'guide', step: 5 });
  assert.equal(state.entries[state.position]?.surface, 'chat');
  state = reduceDemoNavigation(state, { type: 'push', destination: { surface: 'cloud' } });
  assert.equal(state.guide?.exploring, true);
  assert.equal(reduceDemoNavigation(state, { type: 'enter-section', index }), state);
});

test('successive navigation actions keep destination and history position atomic', () => {
  let state = home();
  state = reduceDemoNavigation(state, {
    type: 'push',
    destination: { surface: 'chat', target: 'human:lin' },
  });
  state = reduceDemoNavigation(state, { type: 'push', destination: { surface: 'home' } });
  assert.equal(state.position, 2);
  assert.deepEqual(state.entries[state.position], { surface: 'home' });
  state = reduceDemoNavigation(state, { type: 'go', delta: -1 });
  assert.deepEqual(state.entries[state.position], { surface: 'chat', target: 'human:lin' });
  state = reduceDemoNavigation(state, { type: 'go', delta: 1 });
  assert.deepEqual(state.entries[state.position], { surface: 'home' });
});

test('continuity opens the real Zhiyu preview immediately and switches explicitly to Home and back', () => {
  let state = reduceDemoNavigation(home(), { type: 'enter-section', index: initialDemoSection('#continuity') });
  assert.deepEqual(state.preview, { appId: 'nimi.zhiyu', screen: 'companion', guided: true });
  state = reduceDemoNavigation(state, { type: 'guide', step: 1 });
  assert.equal(state.preview?.screen, 'memory');
  state = reduceDemoNavigation(state, { type: 'guide', step: 2 });
  assert.equal(state.preview, undefined);
  assert.equal(state.entries[state.position]?.surface, 'chat');
  state = reduceDemoNavigation(state, { type: 'guide', step: 3 });
  const library = state.entries;
  state = reduceDemoNavigation(state, { type: 'explore' });
  assert.deepEqual(state.preview, { appId: 'nimi.zhiyu', screen: 'companion', guided: true });
  state = reduceDemoNavigation(state, { type: 'close-preview' });
  assert.equal(state.preview, undefined);
  assert.equal(state.guide?.exploring, true);
  assert.equal(state.entries, library);
  assert.deepEqual(state.entries[state.position], { surface: 'apps', target: 'nimi.zhiyu' });
  state = reduceDemoNavigation(state, { type: 'open-preview', appId: 'nimi.zhiyu' });
  assert.deepEqual(state.preview, { appId: 'nimi.zhiyu', screen: 'home', guided: false });
  state = reduceDemoNavigation(state, { type: 'enter-section', index: initialDemoSection('#worlds') });
  assert.equal(state.preview, undefined);
  assert.equal(state.entries[state.position]?.surface, 'explore');
});

test('changing chat side replaces the active entry without a stale selected target', () => {
  let state = reduceDemoNavigation(home(), {
    type: 'push',
    destination: { surface: 'chat', target: 'human:lin' },
  });
  state = reduceDemoNavigation(state, { type: 'replace', destination: { surface: 'chat' } });
  assert.equal(state.entries.length, 2);
  assert.deepEqual(state.entries[state.position], { surface: 'chat' });
  state = reduceDemoNavigation(state, { type: 'go', delta: -1 });
  assert.equal(state.entries[state.position]!.surface, 'home');
});

test('new navigation after Back drops Forward entries and duplicate destinations do not add history', () => {
  let state = reduceDemoNavigation(home(), { type: 'push', destination: { surface: 'chat' } });
  state = reduceDemoNavigation(state, { type: 'go', delta: -1 });
  state = reduceDemoNavigation(state, { type: 'push', destination: { surface: 'apps' } });
  assert.deepEqual(
    state.entries.map((entry) => entry.surface),
    ['home', 'apps'],
  );
  assert.equal(reduceDemoNavigation(state, { type: 'push', destination: { surface: 'apps' } }), state);
  assert.equal(reduceDemoNavigation(state, { type: 'go', delta: 1 }), state);
  assert.equal(reduceDemoNavigation(home(), { type: 'go', delta: -1 }).position, 0);
});

test('entering the second section selects Chat once and leaves subsequent in-demo navigation alone', () => {
  let state = reduceDemoNavigation(home(), { type: 'enter-section', index: 0 });
  state = reduceDemoNavigation(state, { type: 'enter-section', index: 1 });
  assert.deepEqual(state.entries[state.position], { surface: 'chat' });
  state = reduceDemoNavigation(state, { type: 'push', destination: { surface: 'home' } });
  const unchanged = reduceDemoNavigation(state, { type: 'enter-section', index: 1 });
  assert.equal(unchanged, state);
  assert.equal(unchanged.entries[unchanged.position]!.surface, 'home');
  state = reduceDemoNavigation(state, { type: 'enter-section', index: 0 });
  assert.equal(state.entries[state.position]!.surface, 'home');
  state = reduceDemoNavigation(state, { type: 'enter-section', index: 1 });
  assert.equal(state.entries[state.position]!.surface, 'chat');
});

test('section entry clears an old chat target without resetting the navigation history', () => {
  let state = reduceDemoNavigation(home(), { type: 'enter-section', index: 0 });
  state = reduceDemoNavigation(state, {
    type: 'push',
    destination: { surface: 'chat', target: 'human:lin' },
  });
  const count = state.entries.length;
  state = reduceDemoNavigation(state, { type: 'enter-section', index: 1 });
  assert.deepEqual(state.entries[state.position], { surface: 'chat' });
  assert.equal(state.entries.length, count);
});

test('resetting locale data retires old chats from Back and Forward while keeping the current section', () => {
  let state = reduceDemoNavigation(home(), { type: 'enter-section', index: 1 });
  state = reduceDemoNavigation(state, {
    type: 'push',
    destination: { surface: 'chat', target: 'ai:visitor-created' },
  });
  state = reduceDemoNavigation(state, { type: 'push', destination: { surface: 'settings' } });
  state = reduceDemoNavigation(state, {
    type: 'push',
    destination: { surface: 'chat', target: 'demo:visitor-added-partner' },
  });
  state = reduceDemoNavigation(state, { type: 'go', delta: -1 });

  // The reset must run even when its destination is already the current page.
  state = reduceDemoNavigation(state, { type: 'reset', destination: { surface: 'settings' } });
  assert.deepEqual(state.entries, [{ surface: 'settings' }]);
  assert.equal(state.position, 0);
  assert.equal(reduceDemoNavigation(state, { type: 'go', delta: -1 }), state);
  assert.equal(reduceDemoNavigation(state, { type: 'go', delta: 1 }), state);
  assert.equal(reduceDemoNavigation(state, { type: 'enter-section', index: 1 }), state);

  state = reduceDemoNavigation(state, { type: 'push', destination: { surface: 'chat' } });
  assert.deepEqual(state.entries[state.position], { surface: 'chat' });
  state = reduceDemoNavigation(state, { type: 'go', delta: -1 });
  assert.deepEqual(state.entries[state.position], { surface: 'settings' });
});
