#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const specRoot = 'apps/realm-agent-studio/spec';
const requiredFiles = [
  `${specRoot}/AGENTS.md`,
  `${specRoot}/index.md`,
  `${specRoot}/product-scope.md`,
  `${specRoot}/realm-agent-object.md`,
  `${specRoot}/agent-setting-field-map.md`,
  `${specRoot}/asset-and-binding.md`,
  `${specRoot}/post-publishing.md`,
  `${specRoot}/runtime-ai-consumption.md`,
  `${specRoot}/metrics-and-realm-gaps.md`,
  `${specRoot}/failure-semantics.md`,
  `${specRoot}/storybook.md`,
];
const authorityFiles = requiredFiles.filter((file) => !file.endsWith('/AGENTS.md'));

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function abs(rel) {
  return path.join(cwd, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

if (!exists(specRoot) || !fs.statSync(abs(specRoot)).isDirectory()) {
  fail(`missing Realm Agent Studio spec directory: ${specRoot}`);
}

for (const rel of requiredFiles) {
  if (!exists(rel)) {
    fail(`missing Realm Agent Studio spec file: ${rel}`);
  }
}

const corpus = authorityFiles.map(read).join('\n');
const indexText = exists(`${specRoot}/index.md`) ? read(`${specRoot}/index.md`) : '';
const agentsText = exists(`${specRoot}/AGENTS.md`) ? read(`${specRoot}/AGENTS.md`) : '';

for (const rel of requiredFiles.filter((file) => file.endsWith('.md'))) {
  const content = read(rel);
  if (content.includes('status: pre-admission-authority-draft')) {
    fail(`${rel} still declares pre-admission-authority-draft`);
  }
  if (content.includes('owner: future_apps_realm_agent_studio_spec')) {
    fail(`${rel} still declares future app authority ownership`);
  }
}

for (const rel of [
  'product-scope.md',
  'realm-agent-object.md',
  'agent-setting-field-map.md',
  'asset-and-binding.md',
  'post-publishing.md',
  'runtime-ai-consumption.md',
  'metrics-and-realm-gaps.md',
  'failure-semantics.md',
  'storybook.md',
]) {
  if (!indexText.includes(rel)) {
    fail(`index.md must reference authority document: ${rel}`);
  }
}

if (!/only active Realm Agent Studio app[\s\S]{0,40}authority root/u.test(agentsText)) {
  fail('AGENTS.md must declare the single active app authority root');
}
if (!agentsText.includes('admission-first')) {
  fail('AGENTS.md must declare the admission-first posture');
}
if (!agentsText.includes('/api/me/agents') || !agentsText.includes('/api/me/agents/{agentId}')) {
  fail('AGENTS.md must declare the canonical my-agents surfaces');
}

if (!corpus.includes('/api/me/agents')) {
  fail('authority docs must cite /api/me/agents as canonical surface evidence');
}
if (!corpus.includes('/api/me/agents/{agentId}')) {
  fail('authority docs must cite /api/me/agents/{agentId} as canonical surface evidence');
}

const creatorSurfacePattern = /\/api\/creator\/agents[\s\S]{0,160}\bnot\b[\s\S]{0,80}\bcanonical\b/iu;
if (!creatorSurfacePattern.test(corpus)) {
  fail('authority docs must explicitly exclude /api/creator/agents as a canonical Studio surface');
}
const agentDevSurfacePattern =
  /\/api\/agent\/dev\/my-agents[\s\S]{0,160}\bnot\b[\s\S]{0,80}\bcanonical\b/iu;
if (!agentDevSurfacePattern.test(corpus)) {
  fail('authority docs must explicitly exclude /api/agent/dev/my-agents as a canonical Studio surface');
}

if (!corpus.includes('friendCount')) {
  fail('authority docs must retain friendCount as the admitted owner-visible metric field');
}
if (corpus.includes('agentFriendCount')) {
  fail('authority docs must not introduce agentFriendCount');
}

if (failed) {
  process.exit(1);
}

console.log('Realm Agent Studio admission-first spec consistency check passed');
