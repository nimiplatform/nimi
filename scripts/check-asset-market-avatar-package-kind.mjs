#!/usr/bin/env node
// Guard for active Asset Market avatar Package kind.
//
// Enforces:
//   - avatar is active under Package.package_kind
//   - launched avatar packages are only Live2D/VRM
//   - Sprite2D remains preview-only and inactive
//   - publish/library/api contracts reference avatar-specific gates

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'apps', 'asset-market', 'spec');
const PACKAGE_MODEL = path.join(SPEC, 'kernel', 'tables', 'package-model.yaml');
const API_SURFACE = path.join(SPEC, 'kernel', 'tables', 'api-surface.yaml');
const PACKAGE_CONTRACT = path.join(SPEC, 'kernel', 'package-contract.md');
const PUBLISH_CONTRACT = path.join(SPEC, 'kernel', 'publish-contract.md');
const LIBRARY_CONTRACT = path.join(SPEC, 'kernel', 'library-contract.md');
const API_CONTRACT = path.join(SPEC, 'kernel', 'api-contract.md');

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`[asset-market-avatar-package-kind] FAIL ${message}`);
}

function read(file) {
  return readFileSync(file, 'utf8');
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
    return [];
  }
  return value;
}

function requireIncludes(values, label, expected) {
  if (!values.includes(expected)) {
    fail(`${label} must include ${expected}`);
  }
}

function requireExcludes(values, label, forbidden) {
  if (values.includes(forbidden)) {
    fail(`${label} must not include ${forbidden}`);
  }
}

function requireText(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(`${path.relative(ROOT, file)} must include ${needle}`);
    }
  }
  return text;
}

const model = parse(read(PACKAGE_MODEL))?.package_model;
if (!model || typeof model !== 'object') {
  fail('package_model must exist');
} else {
  const activeKinds = requireArray(model.package_kinds?.active, 'package_kinds.active');
  const reservedKinds = requireArray(model.package_kinds?.reserved_future, 'package_kinds.reserved_future');
  requireIncludes(activeKinds, 'package_kinds.active', 'avatar');
  requireExcludes(reservedKinds, 'package_kinds.reserved_future', 'avatar');
  requireIncludes(reservedKinds, 'package_kinds.reserved_future', 'avatar-sprite2d-preview');

  const avatarProfile = model.package_kind_profiles?.avatar;
  if (!avatarProfile || typeof avatarProfile !== 'object') {
    fail('package_kind_profiles.avatar must exist');
  } else {
    requireIncludes(
      requireArray(avatarProfile.required_package_fields, 'package_kind_profiles.avatar.required_package_fields'),
      'package_kind_profiles.avatar.required_package_fields',
      'avatar_model_layout',
    );
    for (const field of ['backend_kind', 'backend_capability_profile_ref', 'provenance', 'compatibility_diagnostics']) {
      requireIncludes(avatarProfile.required_package_fields, 'package_kind_profiles.avatar.required_package_fields', field);
    }
    const allowedBackends = requireArray(avatarProfile.allowed_backend_kind_values, 'package_kind_profiles.avatar.allowed_backend_kind_values');
    requireIncludes(allowedBackends, 'package_kind_profiles.avatar.allowed_backend_kind_values', 'live2d');
    requireIncludes(allowedBackends, 'package_kind_profiles.avatar.allowed_backend_kind_values', 'vrm');
    for (const forbidden of ['sprite2d', 'canvas2d', 'video']) {
      requireExcludes(allowedBackends, 'package_kind_profiles.avatar.allowed_backend_kind_values', forbidden);
      requireIncludes(
        requireArray(avatarProfile.forbidden_backend_kind_values, 'package_kind_profiles.avatar.forbidden_backend_kind_values'),
        'package_kind_profiles.avatar.forbidden_backend_kind_values',
        forbidden,
      );
    }
  }

  const layout = model.avatar_model_layout;
  if (!layout || typeof layout !== 'object') {
    fail('avatar_model_layout must exist');
  } else {
    for (const field of ['layout_version', 'backend_kind', 'entry_asset_id', 'runtime_root', 'required_asset_ids']) {
      requireIncludes(requireArray(layout.required_fields, 'avatar_model_layout.required_fields'), 'avatar_model_layout.required_fields', field);
    }
    const invariants = requireArray(layout.invariants, 'avatar_model_layout.invariants').join('\n');
    for (const required of ['entry_asset_id must belong to Bundle.memberAssetIds', 'every required_asset_id must belong to Bundle.memberAssetIds', 'layout paths must not be absolute paths or URLs']) {
      if (!invariants.includes(required)) {
        fail(`avatar_model_layout.invariants must include ${required}`);
      }
    }
  }

  const provenance = model.avatar_package_provenance;
  if (!provenance || typeof provenance !== 'object') {
    fail('avatar_package_provenance must exist');
  } else {
    requireIncludes(requireArray(provenance.source_type_enum, 'avatar_package_provenance.source_type_enum'), 'avatar_package_provenance.source_type_enum', 'first_party_curated');
    requireIncludes(requireArray(provenance.source_type_enum, 'avatar_package_provenance.source_type_enum'), 'avatar_package_provenance.source_type_enum', 'imported_local_materialization');
    const invariants = requireArray(provenance.invariants, 'avatar_package_provenance.invariants').join('\n');
    if (!invariants.includes('not Agent Center authority')) {
      fail('avatar_package_provenance.invariants must reject Agent Center authority');
    }
  }
}

for (const [file, needles] of [
  [PACKAGE_CONTRACT, ['AM-PKG-014', 'AM-PKG-015', 'AM-PKG-016', 'AM-PKG-017', 'sprite2d', 'Agent Center inventory records']],
  [PUBLISH_CONTRACT, ['AM-PUBLISH-008', 'backend_kind` is `live2d` or `vrm`', 'Agent Center package refs']],
  [LIBRARY_CONTRACT, ['AM-LIB-005', 'opaque package ref', 'local materialization eligibility']],
  [API_CONTRACT, ['AM-API-005', 'package-kind-aware validation', 'loose file activation endpoint']],
]) {
  requireText(file, needles);
}

const apiRows = requireArray(parse(read(API_SURFACE))?.['package-market'], 'api-surface package-market');
const packageList = apiRows.find((row) => row?.path === '/api/asset-market/packages' && row?.method === 'GET');
const acquire = apiRows.find((row) => row?.path === '/api/asset-market/packages/{packageId}/acquire');
const imports = apiRows.find((row) => row?.path === '/api/asset-market/bundles/{bundleId}/imports');
if (!String(packageList?.description ?? '').includes('package_kind')) {
  fail('GET /api/asset-market/packages description must mention package_kind');
}
if (!String(acquire?.description ?? '').includes('package-kind-aware')) {
  fail('POST /api/asset-market/packages/{packageId}/acquire must be package-kind-aware');
}
if (!String(imports?.description ?? '').includes('Avatar')) {
  fail('POST /api/asset-market/bundles/{bundleId}/imports must mention Avatar');
}

if (failures > 0) {
  console.error(`[asset-market-avatar-package-kind] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[asset-market-avatar-package-kind] PASS');
