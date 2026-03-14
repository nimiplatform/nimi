import assert from 'node:assert/strict';
import test from 'node:test';
import { isWebShellHashRoute } from '../src/site-entry-hash.js';

test('site entry recognizes app hash routes', () => {
  assert.equal(isWebShellHashRoute(''), false);
  assert.equal(isWebShellHashRoute('#install'), false);
  assert.equal(isWebShellHashRoute('#/'), true);
  assert.equal(isWebShellHashRoute('#/login'), true);
  assert.equal(isWebShellHashRoute('#/chat/123'), true);
});
