#!/usr/bin/env node
// Guard for Asset Market Package.package_kind discriminator admission.
//
// Enforces:
//   - Asset Market authority stays under apps/asset-market/spec/**
//   - package_kind is the structural discriminator, distinct from category
//   - active package kinds are explicit
//   - preview-only avatar values stay reserved, not active

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_SPEC = path.join(ROOT, 'apps', 'asset-market', 'spec');
const PACKAGE_MODEL = path.join(ASSET_SPEC, 'kernel', 'tables', 'package-model.yaml');
const API_SURFACE = path.join(ASSET_SPEC, 'kernel', 'tables', 'api-surface.yaml');
const PACKAGE_CONTRACT = path.join(ASSET_SPEC, 'kernel', 'package-contract.md');
const API_CONTRACT = path.join(ASSET_SPEC, 'kernel', 'api-contract.md');
const AGENTS = path.join(ASSET_SPEC, 'AGENTS.md');
const TOP_LEVEL = path.join(ASSET_SPEC, 'asset-market.md');

let failures = 0;

function rel(file) {
  return path.relative(ROOT, file);
}

function fail(message) {
  failures += 1;
  console.error(`[asset-market-package-discriminator] FAIL ${message}`);
}

function read(file) {
  return readFileSync(file, 'utf8');
}

function requireText(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(`${rel(file)} is missing ${needle}`);
    }
  }
  return text;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
    return [];
  }
  return value;
}

function requireIncludes(array, label, value) {
  const hasValue = typeof array?.has === 'function' ? array.has(value) : array.includes(value);
  if (!hasValue) {
    fail(`${label} must include ${value}`);
  }
}

function requireExcludes(array, label, value) {
  const hasValue = typeof array?.has === 'function' ? array.has(value) : array.includes(value);
  if (hasValue) {
    fail(`${label} must not include ${value}`);
  }
}

if (existsSync(path.join(ROOT, '.nimi', 'spec', 'asset-market'))) {
  fail('.nimi/spec/asset-market must not exist; Asset Market authority is apps/asset-market/spec');
}

requireText(AGENTS, [
  'AM-API',
  'AM-MOD',
  'AM-PREVIEW',
  'No parallel Asset Market root',
  'Package.package_kind',
]);

requireText(PACKAGE_CONTRACT, [
    'AM-PKG-011',
    'AM-PKG-012',
    'AM-PKG-013',
    'AM-PKG-014',
  'Package.package_kind',
  'Package.category',
  'tables/package-model.yaml',
]);

requireText(API_CONTRACT, [
  'AM-API-001',
  'AM-API-002',
    'AM-API-003',
    'AM-API-004',
    'AM-API-005',
  'tables/api-surface.yaml',
  'Package.package_kind',
]);

requireText(TOP_LEVEL, ['kernel/api-contract.md', 'AM-API-*']);

const model = parse(read(PACKAGE_MODEL))?.package_model;
if (!model || typeof model !== 'object') {
  fail(`${rel(PACKAGE_MODEL)} must contain package_model object`);
} else {
  const categories = requireArray(model.categories, 'package_model.categories');
  for (const category of ['scenes', 'characters', 'styles']) {
    requireIncludes(categories, 'package_model.categories', category);
  }
  for (const notCategory of ['realm-bundle', 'avatar', 'avatar-sprite2d-preview']) {
    requireExcludes(categories, 'package_model.categories', notCategory);
  }

  const packageKinds = model.package_kinds;
  if (!packageKinds || typeof packageKinds !== 'object') {
    fail('package_model.package_kinds must exist');
  } else {
    const activeKinds = requireArray(packageKinds.active, 'package_model.package_kinds.active');
    const reservedFutureKinds = requireArray(
      packageKinds.reserved_future,
      'package_model.package_kinds.reserved_future',
    );
    const kindInvariants = requireArray(
      packageKinds.invariants,
      'package_model.package_kinds.invariants',
    );

    requireIncludes(activeKinds, 'package_model.package_kinds.active', 'realm-bundle');
    requireIncludes(activeKinds, 'package_model.package_kinds.active', 'avatar');
    requireExcludes(activeKinds, 'package_model.package_kinds.active', 'avatar-sprite2d-preview');
    requireExcludes(reservedFutureKinds, 'package_model.package_kinds.reserved_future', 'avatar');
    requireIncludes(
      reservedFutureKinds,
      'package_model.package_kinds.reserved_future',
      'avatar-sprite2d-preview',
    );

    const invariantText = kindInvariants.join('\n');
    for (const required of ['structural discriminator', 'market-facing classification', 'must not be inferred']) {
      if (!invariantText.includes(required)) {
        fail(`package_model.package_kinds.invariants must mention ${required}`);
      }
    }
  }

  const packageFields = model.package;
  if (!packageFields || typeof packageFields !== 'object') {
    fail('package_model.package must exist');
  } else {
    const requiredFields = requireArray(
      packageFields.required_fields,
      'package_model.package.required_fields',
    );
    const packageInvariants = requireArray(
      packageFields.invariants,
      'package_model.package.invariants',
    );
    requireIncludes(requiredFields, 'package_model.package.required_fields', 'package_kind');
    requireIncludes(requiredFields, 'package_model.package.required_fields', 'category');
    requireIncludes(requiredFields, 'package_model.package.required_fields', 'backend_kind');
    requireIncludes(requiredFields, 'package_model.package.required_fields', 'backend_capability_profile_ref');
    requireIncludes(requiredFields, 'package_model.package.required_fields', 'avatar_model_layout');
    requireIncludes(requiredFields, 'package_model.package.required_fields', 'provenance');

    const invariantText = packageInvariants.join('\n');
    for (const required of ['package_kind must belong to package_kinds.active', 'avatar packages must use backend_kind live2d or vrm', 'category must belong to categories', 'must not be inferred']) {
      if (!invariantText.includes(required)) {
        fail(`package_model.package.invariants must mention ${required}`);
      }
    }
  }

  const readinessFields = requireArray(
    model.readiness?.package_required_for_ready,
    'package_model.readiness.package_required_for_ready',
  );
  requireIncludes(readinessFields, 'package_model.readiness.package_required_for_ready', 'package_kind present and active');
}

const apiSurface = parse(read(API_SURFACE))?.['package-market'];
const apiRows = requireArray(apiSurface, 'api-surface package-market');
const apiPaths = new Set(apiRows.map((row) => row?.path).filter(Boolean));
requireIncludes(apiPaths, 'api-surface package-market paths', '/api/asset-market/packages/{packageId}/acquire');
requireIncludes(apiPaths, 'api-surface package-market paths', '/api/asset-market/bundles/{bundleId}/imports');

if (failures > 0) {
  console.error(`[asset-market-package-discriminator] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[asset-market-package-discriminator] PASS');
