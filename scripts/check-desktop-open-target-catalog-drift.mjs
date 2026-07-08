#!/usr/bin/env node
import {
  failWith,
  parseYaml,
  pass,
  read,
} from './lib/desktop-open-checks.mjs';

const failures = [];
const guardInvariants = new Set([
  'owner.target-kind-vocabulary',
  'owner.desktop-ia-values',
  'owner.open-intent-envelope',
]);
const desktopTargets = parseYaml('.nimi/spec/desktop/kernel/tables/desktop-open-targets.yaml');
const exploreTargets = parseYaml('.nimi/spec/desktop/kernel/tables/explore-open-targets.yaml');
const runtimeTargets = parseYaml('.nimi/spec/desktop/kernel/tables/runtime-config-open-actions.yaml');
const agentsTargets = parseYaml('.nimi/spec/desktop/kernel/tables/agents-open-targets.yaml');
const appsTargets = parseYaml('.nimi/spec/desktop/kernel/tables/apps-open-targets.yaml');
const settingsTargets = parseYaml('.nimi/spec/desktop/kernel/tables/settings-open-targets.yaml');
const golden = parseYaml('.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml');

const targetRefs = desktopTargets.target_refs ?? {};
for (const kind of ['open-explore', 'open-runtime-config', 'open-agents', 'open-apps', 'open-settings']) {
  if (!targetRefs[kind]) {
    failures.push(`desktop-open-targets.yaml missing target_refs.${kind}`);
  }
}

const exploreEntries = new Set(exploreTargets.entries ?? []);
const runtimeEntries = new Set(runtimeTargets.entries ?? []);
const agentsEntries = new Set(agentsTargets.entries ?? []);
const appsEntries = new Set(appsTargets.entries ?? []);
const settingsEntries = new Set(settingsTargets.entries ?? []);

for (const vector of golden.accepted ?? []) {
  const intent = vector.envelope?.intent ?? {};
  if (intent.kind === 'open-explore') {
    const key = intent.productIntent ? `${intent.section}.${intent.productIntent}` : intent.section;
    if (!exploreEntries.has(key)) failures.push(`${vector.id} not covered by explore-open-targets.yaml (${key})`);
  }
  if (intent.kind === 'open-runtime-config') {
    const key = `${intent.page}.${intent.action}`;
    if (!runtimeEntries.has(key)) failures.push(`${vector.id} not covered by runtime-config-open-actions.yaml (${key})`);
  }
  if (intent.kind === 'open-agents' && !agentsEntries.has(intent.view)) {
    failures.push(`${vector.id} not covered by agents-open-targets.yaml (${intent.view})`);
  }
  if (intent.kind === 'open-apps') {
    const key = intent.appId ? 'app-selection' : 'surface';
    if (!appsEntries.has(key)) failures.push(`${vector.id} not covered by apps-open-targets.yaml (${key})`);
  }
  if (intent.kind === 'open-settings' && !settingsEntries.has(intent.section)) {
    failures.push(`${vector.id} not covered by settings-open-targets.yaml (${intent.section})`);
  }
}

const desktopIndex = read('.nimi/spec/desktop/kernel/index.md');
const platformIndex = read('.nimi/spec/platform/kernel/index.md');
for (const relPath of [
  'desktop-open-targets.yaml',
  'explore-open-targets.yaml',
  'runtime-config-open-actions.yaml',
  'settings-open-targets.yaml',
  'agents-open-targets.yaml',
  'apps-open-targets.yaml',
]) {
  if (!desktopIndex.includes(relPath)) {
    failures.push(`desktop kernel index missing ${relPath}`);
  }
}
if (!platformIndex.includes('desktop-open-intent-contract.md') || !platformIndex.includes('desktop-open-intents.yaml')) {
  failures.push('platform kernel index missing Desktop Open Intent contract/table');
}

const ownerContracts = [
  '.nimi/spec/desktop/kernel/ui-shell-contract.md',
  '.nimi/spec/desktop/kernel/nimi-home-shell-contract.md',
  '.nimi/spec/desktop/kernel/explore-surface-contract.md',
  '.nimi/spec/desktop/kernel/bridge-ipc-contract.md',
].map((file) => read(file)).join('\n');
for (const phrase of ['Settings', 'Agents', 'Apps', 'Runtime Config', 'Explore']) {
  if (!ownerContracts.includes(phrase)) {
    failures.push(`Desktop owner contracts missing anchor phrase ${phrase}`);
  }
}
if (guardInvariants.size !== 3) {
  failures.push('desktop open target catalog acceptance assertion registry drifted');
}

failWith('Desktop Open target catalog drift guard failed.', failures);
pass('desktop open target catalog drift guard passed');
