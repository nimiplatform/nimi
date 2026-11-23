import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHomeGreetingName } from '../src/shell/renderer/features/home/home-greeting-model.js';

test('resolveHomeGreetingName keeps custom displayName or handle and omits default Nimi User placeholder', () => {
  assert.equal(resolveHomeGreetingName({ id: 'u1', displayName: 'Nimi User', handle: 'snowzane' }), '');
  assert.equal(resolveHomeGreetingName({ id: 'u1', displayName: '  nimi user  ', handle: '' }), '');
  assert.equal(resolveHomeGreetingName({ id: 'u1', displayName: '  叶小满  ', handle: 'xiaoman' }), '叶小满');
  assert.equal(resolveHomeGreetingName({ id: 'u1', displayName: '   ', handle: '  snowzane  ' }), 'snowzane');
  assert.equal(resolveHomeGreetingName({ id: 'u1', displayName: '', handle: '' }), '');
  assert.equal(resolveHomeGreetingName(null), '');
});
