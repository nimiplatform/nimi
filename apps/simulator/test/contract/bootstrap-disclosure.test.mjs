import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  completeSimulatorBootstrapDisclosure,
  SIMULATOR_BOOTSTRAP_FAILURE_CODE,
  SIMULATOR_BOOTSTRAP_FAILURE_TEXT,
  startSimulator,
} from '../../src/bootstrap/disclosure.ts';

const simulatorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = readFileSync(path.join(simulatorRoot, 'index.html'), 'utf8');

test('static HTML exposes simulation and starting status before JavaScript or CSS', () => {
  const dom = new JSDOM(indexHtml);
  const status = dom.window.document.getElementById('simulator-bootstrap-status');
  assert.ok(status);
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('data-simulator-phase'), 'starting');
  assert.match(status.textContent, /simulated data and effects/u);
  assert.match(status.textContent, /Starting controlled simulation/u);
  assert.equal(dom.window.document.getElementById('root')?.getAttribute('aria-busy'), 'true');
  const disclosureRoot = dom.window.document.getElementById('simulator-disclosure-root');
  const simulatorRootElement = dom.window.document.getElementById('root');
  assert.ok(disclosureRoot);
  assert.ok(simulatorRootElement);
  assert.equal(simulatorRootElement.contains(disclosureRoot), false);
  assert.ok(indexHtml.indexOf('simulator-disclosure-root') < indexHtml.indexOf('id="root"'));
  assert.ok(indexHtml.indexOf('simulator-bootstrap-status') < indexHtml.indexOf('<script'));
  assert.equal(dom.window.document.querySelector('link[rel="icon"]')?.getAttribute('href'), 'data:,');
});

test('bootstrap rejection preserves only the fixed typed failure disclosure', async () => {
  const dom = new JSDOM(indexHtml);
  const secret = 'source-path-and-browser-error-must-not-leak';
  await startSimulator(async () => {
    throw new Error(secret);
  }, dom.window.document);
  const status = dom.window.document.getElementById('simulator-bootstrap-status');
  assert.equal(status?.getAttribute('data-simulator-phase'), 'terminal');
  assert.equal(status?.getAttribute('data-simulator-failure-code'), SIMULATOR_BOOTSTRAP_FAILURE_CODE);
  assert.equal(status?.getAttribute('aria-live'), 'assertive');
  assert.equal(dom.window.document.getElementById('simulator-bootstrap-state')?.textContent, SIMULATOR_BOOTSTRAP_FAILURE_TEXT);
  assert.equal(status?.textContent.includes(secret), false);
  assert.equal(dom.window.document.getElementById('root')?.getAttribute('aria-busy'), 'false');
});

test('committed Shell status replaces the static starting disclosure', () => {
  const dom = new JSDOM(indexHtml);
  completeSimulatorBootstrapDisclosure(dom.window.document);
  assert.equal(dom.window.document.getElementById('simulator-bootstrap-status'), null);
  assert.equal(dom.window.document.getElementById('root')?.getAttribute('aria-busy'), 'false');
});
