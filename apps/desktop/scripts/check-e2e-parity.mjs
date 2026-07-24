#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  ELECTRON_HOST_RUNNER,
  WDIO_RUNNER,
  profilePathForScenario,
  scenarioRegistry,
  scenarioRunner,
} from '../e2e/helpers/registry.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');

function fail(message) {
  process.stderr.write(`[check-e2e-parity] ${message}\n`);
  process.exitCode = 1;
}

function readText(relativePath) {
  return fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mergeDeep(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }
  if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = mergeDeep(baseValue[key], value);
    }
    return merged;
  }
  return overrideValue === undefined ? baseValue : overrideValue;
}

function loadProfileDefinition(filePath, seen = new Set()) {
  const normalizedPath = path.resolve(filePath);
  if (seen.has(normalizedPath)) {
    throw new Error(`E2E profile extends cycle detected: ${normalizedPath}`);
  }
  seen.add(normalizedPath);
  const current = readJson(normalizedPath);
  const parentName = String(current.extends || '').trim();
  if (!parentName) {
    return current;
  }
  const parent = loadProfileDefinition(path.resolve(path.dirname(normalizedPath), parentName), seen);
  const rest = { ...current };
  delete rest.extends;
  return mergeDeep(parent, rest);
}

function scenarioSpecPath(spec) {
  return path.resolve(repoRoot, spec);
}

function listFilesRecursive(rootDir, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, predicate));
      continue;
    }
    if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function assertScenarioRegistryIntegrity() {
  const supportedBuckets = new Set([
    'smoke',
    'journeys',
    'desktop-open',
  ]);
  const supportedRunners = new Set([
    WDIO_RUNNER,
    ELECTRON_HOST_RUNNER,
  ]);
  const registeredSpecPaths = new Set();
  const registeredProfilePaths = new Set();
  for (const [scenarioId, entry] of scenarioRegistry.entries()) {
    if (!supportedBuckets.has(entry.bucket)) {
      fail(`${scenarioId} uses unsupported bucket ${JSON.stringify(entry.bucket)}`);
    }
    const runner = scenarioRunner(entry);
    if (!supportedRunners.has(runner)) {
      fail(`${scenarioId} uses unsupported runner ${JSON.stringify(runner)}`);
    }
    const profilePath = profilePathForScenario(scenarioId);
    registeredProfilePaths.add(path.resolve(profilePath));
    if (!fs.existsSync(profilePath)) {
      fail(`${scenarioId} profile is missing: ${path.relative(repoRoot, profilePath)}`);
    }
    const specPath = scenarioSpecPath(entry.spec);
    registeredSpecPaths.add(path.resolve(specPath));
    if (!fs.existsSync(specPath)) {
      fail(`${scenarioId} spec is missing: ${entry.spec}`);
    }
    loadProfileDefinition(profilePath);
  }

  const specRoot = path.join(desktopRoot, 'e2e', 'specs');
  for (const specPath of listFilesRecursive(specRoot, (filePath) => filePath.endsWith('.e2e.mjs'))) {
    if (!registeredSpecPaths.has(path.resolve(specPath))) {
      fail(`orphan E2E spec is not registered: ${path.relative(repoRoot, specPath)}`);
    }
  }

  const admittedUnregisteredProfiles = new Set([
    '_authenticated-base.json',
  ]);
  const profileRoot = path.join(desktopRoot, 'e2e', 'fixtures', 'profiles');
  for (const profilePath of listFilesRecursive(profileRoot, (filePath) => filePath.endsWith('.json'))) {
    const profileName = path.basename(profilePath);
    if (admittedUnregisteredProfiles.has(profileName)) {
      continue;
    }
    if (!registeredProfilePaths.has(path.resolve(profilePath))) {
      fail(`orphan E2E profile is not registered: ${path.relative(repoRoot, profilePath)}`);
    }
  }
}

function assertAuthenticatedFixtureSurfaceParity() {
  const fixtureServerSource = readText('e2e/fixtures/realm-fixture-server.mjs');
  for (const required of [
    '/api/human/group-chats',
    '/api/economy/balances',
    '/api/economy/subscription',
    '/api/human/notifications/unread-count',
    '/api/world/posts',
  ]) {
    if (!fixtureServerSource.includes(required)) {
      fail(`Realm fixture server does not cover authenticated desktop shell endpoint ${required}`);
    }
  }

  const incompleteProfiles = [];
  for (const [scenarioId] of scenarioRegistry.entries()) {
    const profile = loadProfileDefinition(profilePathForScenario(scenarioId));
    if (!profile?.realmFixture?.currentUser) {
      continue;
    }
    const fixture = profile.realmFixture;
    const missing = [
      fixture.groupChats ? '' : 'groupChats',
      fixture.economyBalances ? '' : 'economyBalances',
      fixture.subscription ? '' : 'subscription',
      fixture.notificationUnreadCount ? '' : 'notificationUnreadCount',
      fixture.postFeed ? '' : 'postFeed',
    ].filter(Boolean);
    if (missing.length > 0) {
      incompleteProfiles.push(`${scenarioId}: ${missing.join(', ')}`);
    }
  }
  if (incompleteProfiles.length > 0) {
    fail(`authenticated E2E profiles are missing current shell fixture surfaces: ${incompleteProfiles.join('; ')}`);
  }
}

try {
  assertScenarioRegistryIntegrity();
  assertAuthenticatedFixtureSurfaceParity();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (process.exitCode) {
  process.exit();
}

process.stdout.write('[check-e2e-parity] desktop E2E fixture parity checks passed\n');
