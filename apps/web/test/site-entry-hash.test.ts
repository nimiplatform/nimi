import assert from 'node:assert/strict';
import test from 'node:test';
import { isWebShellHashRoute, isWebShellPathRoute } from '../src/site-entry-hash.js';

test('site entry recognizes app hash routes', () => {
  assert.equal(isWebShellHashRoute(''), false);
  assert.equal(isWebShellHashRoute('#install'), false);
  assert.equal(isWebShellHashRoute('#/'), true);
  assert.equal(isWebShellHashRoute('#/login'), true);
  assert.equal(isWebShellHashRoute('#/chat/123'), true);
});

test('site entry recognizes app path routes', () => {
  assert.equal(isWebShellPathRoute('/'), false);
  assert.equal(isWebShellPathRoute('/docs/platform/'), false);
  assert.equal(isWebShellPathRoute('/posts/abc'), false);
  assert.equal(isWebShellPathRoute('/login'), true);
});
