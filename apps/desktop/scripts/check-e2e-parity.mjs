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

function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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
  const registeredSpecPaths = new Set();
  const registeredProfilePaths = new Set();
  for (const [scenarioId, entry] of scenarioRegistry.entries()) {
    if (entry.bucket !== 'smoke' && entry.bucket !== 'journeys') {
      fail(`${scenarioId} uses unsupported bucket ${JSON.stringify(entry.bucket)}`);
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
    'chat.live2d-render-smoke-sample.json',
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

function assertCanonicalTranscriptSelectorParity() {
  const transcriptSource = readRepoText('kit/features/chat/src/components/canonical-transcript-view.tsx');
  const humanAdapterSource = readText('src/shell/renderer/features/chat/chat-human-canonical-components.tsx');
  const humanComposerSource = readText('src/shell/renderer/features/chat/chat-human-canonical-composer-profile.tsx');
  const leadingAvatarSource = readText('src/shell/renderer/features/chat/chat-shared-composer-leading-avatar.tsx');
  for (const required of [
    'dataTestId?: string',
    'activeConversationId?: string | null',
    'data-testid={dataTestId}',
    'data-active-chat-id={String(activeConversationId || \'\')}',
  ]) {
    if (!transcriptSource.includes(required)) {
      fail(`canonical transcript does not expose the E2E active conversation contract: ${required}`);
    }
  }
  for (const required of [
    'E2E_IDS.messageTimeline',
    'activeConversationId: input.model.selectedChatId',
  ]) {
    if (!humanAdapterSource.includes(required)) {
      fail(`desktop human chat does not bind canonical transcript selector parity: ${required}`);
    }
  }
  for (const required of [
    'triggerTestId={E2E_IDS.chatHeaderProfileToggle}',
    'openProfileTestId={E2E_IDS.chatOpenUserProfile}',
    "navigateToProfile(targetId, 'profile')",
  ]) {
    if (!humanComposerSource.includes(required)) {
      fail(`desktop human composer does not route profile E2E selectors through the shared profile page: ${required}`);
    }
  }
  for (const required of [
    'triggerTestId?: string',
    'openProfileTestId?: string',
    'data-testid={props.triggerTestId}',
    'data-testid={props.openProfileTestId}',
  ]) {
    if (!leadingAvatarSource.includes(required)) {
      fail(`shared composer leading avatar does not expose canonical profile selector contract: ${required}`);
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
    '/api/human/me/friends/agent-limit',
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
  assertAuthorlessHomeFeedParity();
  assertFixtureRealmOriginBridgeParity();
  assertCanonicalTranscriptSelectorParity();
  assertAuthenticatedFixtureSurfaceParity();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (process.exitCode) {
  process.exit();
}

process.stdout.write('[check-e2e-parity] desktop E2E fixture parity checks passed\n');
