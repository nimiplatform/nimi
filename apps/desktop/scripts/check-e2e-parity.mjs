#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { scenarioRegistry, profilePathForScenario } from '../e2e/helpers/registry.mjs';

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

function hasAuthorlessFeedPosts(profile) {
  const posts = profile?.realmFixture?.exploreFeed?.items;
  return Array.isArray(posts) && posts.some((post) => {
    if (!post || typeof post !== 'object') {
      return false;
    }
    const record = post;
    return typeof record.id === 'string' && !record.author;
  });
}

function assertScenarioRegistryIntegrity() {
  for (const [scenarioId, entry] of scenarioRegistry.entries()) {
    if (entry.bucket !== 'smoke' && entry.bucket !== 'journeys') {
      fail(`${scenarioId} uses unsupported bucket ${JSON.stringify(entry.bucket)}`);
    }
    const profilePath = profilePathForScenario(scenarioId);
    if (!fs.existsSync(profilePath)) {
      fail(`${scenarioId} profile is missing: ${path.relative(repoRoot, profilePath)}`);
    }
    const specPath = scenarioSpecPath(entry.spec);
    if (!fs.existsSync(specPath)) {
      fail(`${scenarioId} spec is missing: ${entry.spec}`);
    }
    loadProfileDefinition(profilePath);
  }
}

function assertAuthorlessHomeFeedParity() {
  const profilesWithAuthorlessPosts = [];
  for (const [scenarioId] of scenarioRegistry.entries()) {
    const profile = loadProfileDefinition(profilePathForScenario(scenarioId));
    if (hasAuthorlessFeedPosts(profile)) {
      profilesWithAuthorlessPosts.push(scenarioId);
    }
  }
  if (profilesWithAuthorlessPosts.length === 0) {
    return;
  }

  const postCardSource = readText('src/shell/renderer/features/home/post-card.tsx');
  const postCardArticleSource = readText('src/shell/renderer/features/home/article.tsx');
  const unsafePostCardAuthorReads = postCardSource.match(/post\.author\.(id|displayName|handle|avatarUrl|isAgent)/g) || [];
  const unsafeArticleAuthorReads = postCardArticleSource.match(/props\.post\.author\.(id|displayName|handle|avatarUrl|isAgent)/g) || [];

  if (unsafePostCardAuthorReads.length > 0 || unsafeArticleAuthorReads.length > 0) {
    fail([
      `authorless feed posts are admitted by E2E profiles (${profilesWithAuthorlessPosts.join(', ')}),`,
      'but renderer home feed still contains direct author projection reads:',
      [...unsafePostCardAuthorReads, ...unsafeArticleAuthorReads].join(', '),
    ].join(' '));
  }
}

function assertFixtureRealmOriginBridgeParity() {
  const runnerSource = readText('scripts/run-e2e.mjs');
  const envHttpSource = readText('src-tauri/src/main_parts/env_http.rs');
  if (!/fixtureOrigin: fixtureServer\.origin/.test(runnerSource)) {
    fail('E2E runner no longer forwards the live Realm fixture origin into scenario manifests');
  }
  for (const required of [
    'runtime_defaults_override()',
    'defaults.realm.realm_base_url',
    'defaults.realm.jwks_url',
    'defaults.realm.revocation_url',
    'defaults.realm.jwt_issuer',
  ]) {
    if (!envHttpSource.includes(required)) {
      fail(`packaged HTTP bridge allowlist does not admit fixture Realm default ${required}`);
    }
  }
}

try {
  assertScenarioRegistryIntegrity();
  assertAuthorlessHomeFeedParity();
  assertFixtureRealmOriginBridgeParity();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (process.exitCode) {
  process.exit();
}

process.stdout.write('[check-e2e-parity] desktop E2E fixture parity checks passed\n');
