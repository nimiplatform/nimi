#!/usr/bin/env node
// Guard for Sprite2D preview-only boundary in kit/features/avatar.
//
// Enforces:
//   - shared AvatarBackendKind admits only launched Avatar backends
//   - sprite2d/canvas2d/video do not re-enter kit as launched backends
//   - Sprite2D remains reserved under Asset Market preview package-kind work

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT_AVATAR = path.join(ROOT, 'kit', 'features', 'avatar');
const APPS_AVATAR_SRC = path.join(ROOT, 'apps', 'avatar', 'src');
const TYPES = path.join(KIT_AVATAR, 'src', 'types.ts');
const HEADLESS = path.join(KIT_AVATAR, 'src', 'headless.ts');
const COMPONENT = path.join(KIT_AVATAR, 'src', 'components', 'avatar-stage.tsx');
const BACKEND_CONTRACT = path.join(ROOT, '.nimi', 'spec', 'avatar', 'kernel', 'backend-branch-contract.md');
const PACKAGE_MODEL = path.join(ROOT, 'apps', 'asset-market', 'spec', 'kernel', 'tables', 'package-model.yaml');
const KIT_AGENTS = path.join(ROOT, 'kit', 'AGENTS.md');
const KIT_REGISTRY = path.join(ROOT, '.nimi', 'spec', 'platform', 'kernel', 'tables', 'nimi-kit-registry.yaml');

let failures = 0;

function rel(file) {
  return path.relative(ROOT, file);
}

function fail(message) {
  failures += 1;
  console.error(`[kit-avatar-backend-vocabulary] FAIL ${message}`);
}

function read(file) {
  return readFileSync(file, 'utf8');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const typeText = read(TYPES);
if (!typeText.includes("export type AvatarBackendKind = 'vrm' | 'live2d';")) {
  fail(`${rel(TYPES)} must keep AvatarBackendKind closed to 'vrm' | 'live2d'`);
}

const forbiddenBackendValue = /(['"`])(sprite2d|canvas2d|video)\1/u;
for (const file of [...walk(KIT_AVATAR), ...walk(APPS_AVATAR_SRC)]) {
  const text = read(file);
  const match = text.match(forbiddenBackendValue);
  if (match) {
    fail(`${rel(file)} contains forbidden launched backend literal ${match[0]}`);
  }
}

const headless = read(HEADLESS);
for (const forbidden of [
  "fallbackBackendKind || 'sprite2d'",
  "createFallbackPresentationProfile('sprite2d'",
  "createFallbackPresentationProfile('canvas2d'",
  'resolveSpriteAvatarImageUrl',
  'defaults.canvas2d',
]) {
  if (headless.includes(forbidden)) {
    fail(`${rel(HEADLESS)} contains forbidden fallback vocabulary ${forbidden}`);
  }
}
if (!headless.includes('resolveAvatarStagePosterUrl')) {
  fail(`${rel(HEADLESS)} must expose poster/fallback media without Sprite2D backend vocabulary`);
}

const component = read(COMPONENT);
for (const forbidden of ['renderSpriteAvatarStage', 'renderVideoAvatarStage', 'renderCanvasAvatarStage']) {
  if (component.includes(forbidden)) {
    fail(`${rel(COMPONENT)} still contains ${forbidden}`);
  }
}
if (!component.includes("Record<'vrm' | 'live2d', AvatarStageBackendRenderer>")) {
  fail(`${rel(COMPONENT)} default renderer registry must be closed to vrm/live2d`);
}

const backendContract = read(BACKEND_CONTRACT);
if (!backendContract.includes("export type BackendKind = 'live2d' | 'vrm';")) {
  fail(`${rel(BACKEND_CONTRACT)} must keep BackendKind closed to live2d/vrm`);
}

const packageModel = parse(read(PACKAGE_MODEL))?.package_model;
const activeKinds = packageModel?.package_kinds?.active ?? [];
const reservedFuture = packageModel?.package_kinds?.reserved_future ?? [];
if (!Array.isArray(activeKinds) || activeKinds.includes('avatar-sprite2d-preview')) {
  fail('avatar-sprite2d-preview must not be an active package_kind');
}
if (!Array.isArray(reservedFuture) || !reservedFuture.includes('avatar-sprite2d-preview')) {
  fail('avatar-sprite2d-preview must remain reserved under Asset Market preview admission');
}

const kitAgents = read(KIT_AGENTS);
for (const required of [
  'kit/features/avatar',
  'Desktop chat preview/viewport stage/media utility',
  'not the launched `apps/avatar` carrier surface',
  '.nimi/spec/avatar/kernel/backend-branch-contract.md',
  '`live2d | vrm`',
]) {
  if (!kitAgents.includes(required)) {
    fail(`${rel(KIT_AGENTS)} must document kit/features/avatar as Desktop preview utility, not launched Avatar authority (${required})`);
  }
}

const registry = parse(read(KIT_REGISTRY));
const avatarModule = registry?.modules?.find((row) => row?.id === 'kit.features.avatar');
if (!avatarModule) {
  fail(`${rel(KIT_REGISTRY)} must register kit.features.avatar`);
} else {
  const avatarRegistryText = `${avatarModule.description || ''}\n${avatarModule.notes || ''}`;
  for (const required of [
    'Desktop chat preview/viewport',
    'stage',
    'media utility',
    'not the launched `apps/avatar` carrier surface',
    '.nimi/spec/avatar/kernel/backend-branch-contract.md',
    'live2d | vrm',
    'must not admit `sprite2d`, `canvas2d`, or `video`',
  ]) {
    if (!avatarRegistryText.includes(required)) {
      fail(`${rel(KIT_REGISTRY)} kit.features.avatar must preserve Desktop preview-only registry boundary (${required})`);
    }
  }
}

if (failures > 0) {
  console.error(`[kit-avatar-backend-vocabulary] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[kit-avatar-backend-vocabulary] PASS');
