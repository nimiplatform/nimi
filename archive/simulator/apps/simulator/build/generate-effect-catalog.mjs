#!/usr/bin/env node

/**
 * Generates the Simulator browser-effect runtime catalog from implementation
 * policy tables constrained by the P-SIM product authority. The generated
 * module is a deterministic projection and is never hand-maintained.
 *
 * Product authority: .nimi/spec/platform/simulator.authority.yaml.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { GENERATED_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';

const EFFECTS_TABLE = 'config/platform-simulator-browser-effects.yaml';
const LISTENERS_TABLE = 'config/platform-simulator-listener-families.yaml';

const OWNER_MAP = {
  simulator_bootstrap: 'simulator-bootstrap',
  simulator_shell: 'simulator-shell',
  simulator_state_engine: 'state-engine',
  kit_coordinator: 'kit-coordinator',
  kit_primitive: 'kit-primitive',
  sdk_harness: 'sdk-harness',
  app_adapter: 'app-adapter',
  canonical_renderer: 'canonical-renderer',
  selected_dependency: 'selected-dependency',
};

const PHASE_MAP = {
  bootstrap: 'bootstrap',
  module_evaluation: 'module-evaluation',
  instance_lifecycle: 'instance-lifecycle',
  render: 'render',
  callback: 'callback',
  test_only: 'test-only',
};

const CLASSIFICATION_MAP = {
  pure_read: 'pure-read',
  port_only: 'port-only',
  forbidden: 'forbidden',
};

// Abstract catalog surfaces name coordination concepts rather than concrete,
// interceptable browser objects, so they have no runtime wrapper.
const ABSTRACT_SURFACES = new Set([
  'portal_into_assigned_overlay_root',
  'global_aria_state',
  'global_scroll_lock',
  'new_Date_without_explicit_value',
]);

function targetKindFor(surface) {
  if (ABSTRACT_SURFACES.has(surface)) return 'abstract';
  if (surface.includes('.prototype.')) return 'prototype';
  if (/^(XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|BroadcastChannel|MessageChannel|ResizeObserver|IntersectionObserver|MutationObserver|HTMLFormElement\.submit)$/.test(surface)) {
    return surface === 'HTMLFormElement.submit' ? 'prototype' : 'constructor';
  }
  if (/^(localStorage|sessionStorage|indexedDB|globalThis\.caches|document\.cookie|performance\.timeOrigin|document\.documentElement|document\.body|HTMLElement\.inert)$/.test(surface)) {
    return 'member-accessor';
  }
  return 'member-call';
}

function targetPathFor(surface) {
  if (surface === 'globalThis.fetch') return 'globalThis.fetch';
  if (surface === 'globalThis.caches') return 'globalThis.caches';
  if (surface === 'window.postMessage') return 'globalThis.postMessage';
  if (surface === 'window.open') return 'globalThis.open';
  if (surface === 'window.addEventListener') return 'globalThis.addEventListener';
  if (surface === 'document.addEventListener') return 'document.addEventListener';
  if (surface === 'HTMLElement.inert') return 'HTMLElement.prototype.inert';
  if (surface === 'HTMLFormElement.submit') return 'HTMLFormElement.prototype.submit';
  if (surface === 'MessagePort.postMessage') return 'MessagePort.prototype.postMessage';
  if (surface === 'showOpenFilePicker') return 'globalThis.showOpenFilePicker';
  if (surface === 'showSaveFilePicker') return 'globalThis.showSaveFilePicker';
  if (surface === 'showDirectoryPicker') return 'globalThis.showDirectoryPicker';
  if (surface.startsWith('location.')) return `globalThis.${surface}`;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(surface)) return `globalThis.${surface}`;
  return surface;
}

function buildRuntimeCatalog(effectsTable, listenersTable) {
  const rows = [];
  for (const entry of effectsTable.entries) {
    const surfaces = String(entry.browser_surface).split('|').map((surface) => surface.trim());
    const permittedOwners = [entry.permitted_owner, ...(entry.permitted_owners ?? [])]
      .filter(Boolean)
      .map((owner) => OWNER_MAP[owner] ?? owner);
    for (const [index, surface] of surfaces.entries()) {
      const targetKind = targetKindFor(surface);
      rows.push({
        id: surfaces.length > 1 ? `${entry.id}#${index}` : entry.id,
        familyId: entry.id,
        targetPath: targetPathFor(surface),
        targetKind,
        classification: CLASSIFICATION_MAP[entry.classification],
        governedOwners: (entry.governed_owners ?? []).map((owner) => OWNER_MAP[owner] ?? owner),
        permittedOwners,
        phases: (entry.phases ?? []).map((phase) => PHASE_MAP[phase] ?? phase),
      });
    }
  }
  const listenerFamilies = (listenersTable.families ?? []).map((family) => ({
    id: family.id,
    eventTarget: family.event_target,
    eventTypes: family.event_types ?? [],
    capture: family.capture === true,
    passive: family.passive === true,
    owner: OWNER_MAP[family.listener_owner] ?? family.listener_owner,
  }));
  return {
    effects: rows,
    listenerFamilies,
  };
}

export function generateEffectCatalog({ write = true, generatedRoot = GENERATED_ROOT } = {}) {
  const effectsPath = path.join(REPO_ROOT, EFFECTS_TABLE);
  const listenersPath = path.join(REPO_ROOT, LISTENERS_TABLE);
  const effectsBytes = readFileSync(effectsPath);
  const listenersBytes = readFileSync(listenersPath);
  const effectsTable = YAML.parse(effectsBytes.toString('utf8'), { uniqueKeys: true });
  const listenersTable = YAML.parse(listenersBytes.toString('utf8'), { uniqueKeys: true });
  const catalog = buildRuntimeCatalog(effectsTable, listenersTable);
  if (write) {
    const typescript = [
      '// Generated by apps/simulator/build/generate-effect-catalog.mjs. Do not edit.',
      `export const simulatorEffectCatalog = ${JSON.stringify(catalog, null, 2)} as const;`,
      '',
    ].join('\n');
    writeFileSync(path.join(generatedRoot, 'effect-catalog.ts'), typescript);
  }
  return catalog;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const catalog = generateEffectCatalog({ write: true });
  process.stdout.write(`simulator-effect-catalog: OK (${catalog.effects.length} effects, ${catalog.listenerFamilies.length} listener families)\n`);
}
