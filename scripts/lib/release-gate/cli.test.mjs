// Tests for scripts/lib/release-gate/cli.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from './cli.mjs';

test('default options: tier=release target=any allow-blocked=[live,external-repo]', () => {
  const r = parseArgs([]);
  assert.equal(r.ok, true);
  assert.equal(r.options.tier, 'release');
  assert.equal(r.options.target, 'any');
  assert.deepEqual(r.options.allowBlockedTiers.sort(), ['external-repo', 'live']);
  assert.equal(r.options.requireRelease, false);
  assert.equal(r.options.json, false);
  assert.equal(r.options.color, true);
});

test('--require-release sets default allow-blocked-tiers to empty', () => {
  const r = parseArgs(['--require-release']);
  assert.equal(r.ok, true);
  assert.equal(r.options.requireRelease, true);
  assert.deepEqual(r.options.allowBlockedTiers, []);
});

test('--require-release combined with --allow-blocked-tiers is rejected', () => {
  const r = parseArgs(['--require-release', '--allow-blocked-tiers', 'live']);
  assert.equal(r.ok, false);
  assert.match(r.error, /forbids/);
});

test('--tier with value', () => {
  const r = parseArgs(['--tier', 'fast']);
  assert.equal(r.ok, true);
  assert.equal(r.options.tier, 'fast');
});

test('--tier without value rejected', () => {
  const r = parseArgs(['--tier']);
  assert.equal(r.ok, false);
});

test('--include csv parsing', () => {
  const r = parseArgs(['--include', 'live,nightly']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.options.include, ['live', 'nightly']);
});

test('--allow-blocked-tiers csv parsing', () => {
  const r = parseArgs(['--allow-blocked-tiers', 'live']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.options.allowBlockedTiers, ['live']);
});

test('--filter glob value', () => {
  const r = parseArgs(['--filter', 'gate.runtime.*']);
  assert.equal(r.ok, true);
  assert.equal(r.options.filter, 'gate.runtime.*');
});

test('--require-release combined with --filter is rejected', () => {
  const r = parseArgs(['--require-release', '--filter', 'gate.runtime.*']);
  assert.equal(r.ok, false);
  assert.match(r.error, /forbids --filter/);
});

test('--no-color flips color flag', () => {
  const r = parseArgs(['--no-color']);
  assert.equal(r.ok, true);
  assert.equal(r.options.color, false);
});

test('--evidence-out is rejected', () => {
  const r = parseArgs(['--evidence-out', '/tmp/x.json']);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown argument/);
});

test('--registry-path is rejected', () => {
  const r = parseArgs(['--registry-path', '/tmp/registry.yaml']);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown argument/);
});

test('unknown argument rejected', () => {
  const r = parseArgs(['--bogus']);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown argument/);
});

test('--help flag set', () => {
  const r = parseArgs(['--help']);
  assert.equal(r.ok, true);
  assert.equal(r.options.help, true);
});
