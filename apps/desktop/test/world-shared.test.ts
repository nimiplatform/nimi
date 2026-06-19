import assert from 'node:assert/strict';
import test from 'node:test';

import { getStatusBadgeStyle, getWorldInitial } from '../src/shell/renderer/features/world/shared';

test('getStatusBadgeStyle returns green for DISCOVERABLE', () => {
  const style = getStatusBadgeStyle('DISCOVERABLE');
  assert.equal(style.bg, 'bg-green-100');
  assert.equal(style.text, 'text-green-700');
});

test('getStatusBadgeStyle returns blue for PUBLIC', () => {
  const style = getStatusBadgeStyle('PUBLIC');
  assert.equal(style.bg, 'bg-blue-100');
  assert.equal(style.text, 'text-blue-700');
});

test('getStatusBadgeStyle returns gray for SYSTEM', () => {
  const style = getStatusBadgeStyle('SYSTEM');
  assert.equal(style.bg, 'bg-gray-100');
  assert.equal(style.text, 'text-gray-600');
});

test('getStatusBadgeStyle returns gray for unknown status', () => {
  const style = getStatusBadgeStyle('UNKNOWN');
  assert.equal(style.bg, 'bg-gray-100');
  assert.equal(style.text, 'text-gray-600');
});

test('getStatusBadgeStyle returns gray for empty string', () => {
  const style = getStatusBadgeStyle('');
  assert.equal(style.bg, 'bg-gray-100');
  assert.equal(style.text, 'text-gray-600');
});

test('getWorldInitial returns uppercased first character', () => {
  assert.equal(getWorldInitial('hello'), 'H');
  assert.equal(getWorldInitial('World'), 'W');
  assert.equal(getWorldInitial('a'), 'A');
});

test('getWorldInitial handles empty string', () => {
  assert.equal(getWorldInitial(''), '');
});

test('getWorldInitial handles numeric start', () => {
  assert.equal(getWorldInitial('123'), '1');
});

test('getWorldInitial handles unicode', () => {
  const initial = getWorldInitial('nimi');
  assert.equal(initial, 'N');
});
