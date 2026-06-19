import assert from 'node:assert/strict';
import test from 'node:test';
import { read, readTesterAiTestingSurface, root } from './helpers.mjs';

test('no-input runtime capabilities keep a readonly composer field', () => {
  const capabilities = readTesterAiTestingSurface(root);
  const styles = read('src/tester/tester-workbench.css');

  assert.match(capabilities, /const isReadOnlyComposer = profile\.inputKind === 'none'/);
  assert.match(capabilities, /const composerInputValue = isReadOnlyComposer \? \(profile\.inputNote \?\? ''\) : prompt/);
  assert.match(capabilities, /className=\{isReadOnlyComposer \? 'studio-input studio-input--readonly' : 'studio-input'\}/);
  assert.match(capabilities, /readOnly=\{isReadOnlyComposer\}/);
  assert.match(capabilities, /aria-readonly=\{isReadOnlyComposer \? true : undefined\}/);
  assert.match(capabilities, /onChange=\{isReadOnlyComposer \? undefined :/);
  assert.doesNotMatch(capabilities, /<p className="studio-note">\{profile\.inputNote\}<\/p>/);
  assert.match(styles, /\.studio-input--readonly/);
  assert.match(styles, /\.studio-input--readonly textarea/);
});
