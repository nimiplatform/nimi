// Avatar spec consistency check.
// Validates that:
//  1. Required spec authority files exist on disk (kernel + tables + guide).
//  2. Wave 2 implementation surfaces (i18n locales + tokens.css) exist.
//  3. Every i18n key listed in `src/shell/renderer/i18n/key-catalog.yaml` is
//     present in BOTH `locales/en/avatar.json` and `locales/zh/avatar.json`,
//     and no orphan keys exist in either locale file (1:1 alignment).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(ROOT, '../..');
const AVATAR_SPEC_ROOT = resolve(REPO_ROOT, '.nimi/spec/avatar');

const requiredAuthorityPaths = [
  'index.md',
  'nimi-avatar.md',
  'kernel/index.md',
  'kernel/embodiment-projection-contract.md',
  'kernel/agent-script-contract.md',
  'kernel/avatar-event-contract.md',
  'kernel/app-shell-contract.md',
  'kernel/wake-local-audio-lifecycle-contract.md',
  'kernel/backend-branch-contract.md',
  'kernel/generated-motion-provider-contract.md',
  'kernel/live2d-render-contract.md',
  'kernel/live2d-asset-compatibility-contract.md',
  'kernel/carrier-visual-acceptance-contract.md',
  'kernel/mock-fixture-contract.md',
  'kernel/nimi2d-backend-contract.md',
  'kernel/nimi2d-live-action-bench-contract.md',
  'kernel/vrm-backend-contract.md',
  'kernel/tables/feature-matrix.yaml',
  'kernel/tables/activity-mapping.yaml',
  'kernel/tables/acceptance-recording-matrix.yaml',
  'kernel/tables/backend-capability-profile.schema.yaml',
  'kernel/tables/generated-motion-routes.yaml',
  'kernel/tables/live2d-compatibility-tiers.yaml',
  'kernel/tables/mapping-sidecar.schema.yaml',
  'kernel/tables/nimi2d-backend-capability-profile.schema.yaml',
  'kernel/tables/nimi2d-live-action-routes.yaml',
  'kernel/tables/scenario-catalog.yaml',
  'kernel/tables/window-bounds-policy.yaml',
  'kernel/tables/vrm-emote-states.yaml',
  'kernel/tables/vrm-motion-presets.yaml',
];

const requiredAppPaths = [
  'src/shell/renderer/i18n/key-catalog.yaml',
  'src/shell/renderer/locales/en/avatar.json',
  'src/shell/renderer/locales/zh/avatar.json',
  'src/shell/renderer/app-shell/tokens.css',
];

const requiredPaths = [...requiredAuthorityPaths, ...requiredAppPaths];
const requiredAcceptanceScenarioIds = [
  'idle_vrm_ready',
  'idle_live2d_ready',
  'hover_body',
  'click_body',
  'drag_stage',
  'runtime_voice_listening_projection',
  'tts_speaking_lipsync',
  'interrupt_active_turn',
  'runtime_degraded',
  'shared_auth_broker_ready',
  'shared_auth_login_required',
  'first_party_raw_token_posture',
  'binding_only_raw_token_denied',
];

const missing = requiredPaths
  .map((relativePath) => ({
    relativePath,
    absolutePath: resolvePath(relativePath),
  }))
  .filter(({ absolutePath }) => !existsSync(absolutePath));

if (missing.length > 0) {
  console.error('Avatar spec consistency check failed. Missing required authority files:');
  for (const entry of missing) {
    console.error(`- ${entry.relativePath}`);
  }
  process.exit(1);
}

function readCatalogKeys(): string[] {
  const yamlPath = resolve(ROOT, 'src/shell/renderer/i18n/key-catalog.yaml');
  const yaml = readFileSync(yamlPath, 'utf8');
  const parsed = YAML.parse(yaml) as Record<string, unknown>;
  if (parsed['catalog_id'] !== 'avatar_i18n_key_catalog') {
    throw new Error('src/shell/renderer/i18n/key-catalog.yaml catalog_id must be avatar_i18n_key_catalog');
  }

  const copyAuthorityFields = ['english_baseline', 'default_value', 'copy', 'translation_value'];
  const copyFieldErrors: string[] = [];
  function scanForCopyFields(value: unknown, path: string): void {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => scanForCopyFields(entry, `${path}[${index}]`));
      return;
    }
    for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${field}` : field;
      if (copyAuthorityFields.includes(field)) {
        copyFieldErrors.push(next);
      }
      scanForCopyFields(child, next);
    }
  }
  scanForCopyFields(parsed, '');
  if (copyFieldErrors.length > 0) {
    throw new Error(`i18n key catalog must not carry concrete copy fields:\n  - ${copyFieldErrors.join('\n  - ')}`);
  }

  const namespaces = Array.isArray(parsed['namespaces']) ? parsed['namespaces'] : [];
  const keys: string[] = [];
  const errors: string[] = [];
  for (const [namespaceIndex, namespace] of namespaces.entries()) {
    if (!namespace || typeof namespace !== 'object') {
      errors.push(`namespaces[${namespaceIndex}] must be an object`);
      continue;
    }
    const namespaceRecord = namespace as Record<string, unknown>;
    const entries = Array.isArray(namespaceRecord['keys']) ? namespaceRecord['keys'] : [];
    if (entries.length === 0) {
      errors.push(`namespaces[${namespaceIndex}] must declare at least one key`);
      continue;
    }
    for (const [keyIndex, entry] of entries.entries()) {
      if (!entry || typeof entry !== 'object') {
        errors.push(`namespaces[${namespaceIndex}].keys[${keyIndex}] must be an object`);
        continue;
      }
      const key = (entry as Record<string, unknown>)['key'];
      if (typeof key !== 'string' || !key.startsWith('Avatar.') || key.trim() !== key) {
        errors.push(`namespaces[${namespaceIndex}].keys[${keyIndex}].key must be a trimmed Avatar.* key`);
        continue;
      }
      keys.push(key);
    }
  }
  if (keys.length === 0) {
    errors.push('src/shell/renderer/i18n/key-catalog.yaml declares zero keys');
  }
  const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    errors.push(`duplicate i18n key declarations:\n  - ${[...new Set(duplicateKeys)].join('\n  - ')}`);
  }
  if (errors.length > 0) {
    throw new Error(`invalid Avatar i18n key catalog:\n  - ${errors.join('\n  - ')}`);
  }
  return keys;
}

// Flatten a nested object into dot-namespaced leaves.
function flattenKeys(obj: unknown, prefix: string, sink: string[]): void {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenKeys(v, next, sink);
    } else {
      sink.push(next);
    }
  }
}

function readLocaleKeys(relativePath: string): { keys: string[]; emptyKeys: string[]; todoKeys: string[] } {
  const fullPath = resolve(ROOT, relativePath);
  const json = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  const collected: string[] = [];
  flattenKeys(json, '', collected);
  const emptyKeys: string[] = [];
  const todoKeys: string[] = [];
  // Re-walk to detect invalid copy leaves.
  function walk(obj: unknown, prefix: string): void {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, next);
      } else if (typeof v !== 'string' || v.trim().length === 0) {
        emptyKeys.push(next);
      } else if (/\bTODO\b|\bTBD\b|待定|占位/u.test(v)) {
        todoKeys.push(next);
      }
    }
  }
  walk(json, '');
  return { keys: collected, emptyKeys, todoKeys };
}

const catalogKeys = readCatalogKeys();
const enLocale = readLocaleKeys('src/shell/renderer/locales/en/avatar.json');
const zhLocale = readLocaleKeys('src/shell/renderer/locales/zh/avatar.json');

const errors: string[] = [];

const catalogKeySet = new Set(catalogKeys);
const enKeySet = new Set(enLocale.keys);
const zhKeySet = new Set(zhLocale.keys);

const enMissing = catalogKeys.filter((k) => !enKeySet.has(k));
const zhMissing = catalogKeys.filter((k) => !zhKeySet.has(k));
const enOrphan = enLocale.keys.filter((k) => !catalogKeySet.has(k));
const zhOrphan = zhLocale.keys.filter((k) => !catalogKeySet.has(k));

if (enMissing.length > 0) {
  errors.push(`locales/en/avatar.json is missing ${enMissing.length} key(s) declared in key-catalog.yaml:\n  - ${enMissing.join('\n  - ')}`);
}
if (zhMissing.length > 0) {
  errors.push(`locales/zh/avatar.json is missing ${zhMissing.length} key(s) declared in key-catalog.yaml:\n  - ${zhMissing.join('\n  - ')}`);
}
if (enOrphan.length > 0) {
  errors.push(`locales/en/avatar.json has ${enOrphan.length} orphan key(s) not declared in key-catalog.yaml:\n  - ${enOrphan.join('\n  - ')}`);
}
if (zhOrphan.length > 0) {
  errors.push(`locales/zh/avatar.json has ${zhOrphan.length} orphan key(s) not declared in key-catalog.yaml:\n  - ${zhOrphan.join('\n  - ')}`);
}
if (enLocale.emptyKeys.length > 0) {
  errors.push(`locales/en/avatar.json has ${enLocale.emptyKeys.length} empty / non-string leaf(s):\n  - ${enLocale.emptyKeys.join('\n  - ')}`);
}
if (zhLocale.emptyKeys.length > 0) {
  errors.push(`locales/zh/avatar.json has ${zhLocale.emptyKeys.length} empty / non-string leaf(s):\n  - ${zhLocale.emptyKeys.join('\n  - ')}`);
}
if (enLocale.todoKeys.length > 0) {
  errors.push(`locales/en/avatar.json has ${enLocale.todoKeys.length} TODO/TBD placeholder leaf(s):\n  - ${enLocale.todoKeys.join('\n  - ')}`);
}
if (zhLocale.todoKeys.length > 0) {
  errors.push(`locales/zh/avatar.json has ${zhLocale.todoKeys.length} TODO/TBD placeholder leaf(s):\n  - ${zhLocale.todoKeys.join('\n  - ')}`);
}

const acceptanceMatrixErrors = validateAcceptanceRecordingMatrix();
if (acceptanceMatrixErrors.length > 0) {
  errors.push(`acceptance-recording-matrix.yaml drift detected:\n  - ${acceptanceMatrixErrors.join('\n  - ')}`);
}

if (errors.length > 0) {
  console.error('Avatar spec consistency check failed. i18n drift detected:');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log('Avatar spec consistency check passed.');
console.log(`- ${requiredPaths.length} required authority files present`);
console.log(`- ${catalogKeys.length} i18n keys aligned across app catalog / en / zh`);
console.log(`- ${requiredAcceptanceScenarioIds.length} acceptance recording scenarios aligned`);

function resolvePath(relativePath: string): string {
  if (requiredAuthorityPaths.includes(relativePath)) {
    return resolve(AVATAR_SPEC_ROOT, relativePath);
  }
  return resolve(ROOT, relativePath);
}

function validateAcceptanceRecordingMatrix(): string[] {
  const matrixPath = resolve(AVATAR_SPEC_ROOT, 'kernel/tables/acceptance-recording-matrix.yaml');
  const matrix = YAML.parse(readFileSync(matrixPath, 'utf8')) as Record<string, unknown>;
  const errors: string[] = [];
  if (matrix['catalog_id'] !== 'avatar_acceptance_recording_matrix') {
    errors.push('catalog_id must be avatar_acceptance_recording_matrix');
  }
  const scenarios = Array.isArray(matrix['scenarios']) ? matrix['scenarios'] : [];
  const scenarioIds = scenarios
    .map((scenario) => {
      if (!scenario || typeof scenario !== 'object') return '';
      const id = (scenario as Record<string, unknown>)['id'];
      return typeof id === 'string' ? id.trim() : '';
    })
    .filter(Boolean);
  for (const requiredId of requiredAcceptanceScenarioIds) {
    if (!scenarioIds.includes(requiredId)) {
      errors.push(`missing scenario ${requiredId}`);
    }
  }
  for (const id of scenarioIds) {
    if (!requiredAcceptanceScenarioIds.includes(id)) {
      errors.push(`unexpected scenario ${id}`);
    }
  }
  const artifactRequirements = matrix['artifact_requirements'];
  const artifactRecord =
    artifactRequirements && typeof artifactRequirements === 'object'
      ? artifactRequirements as Record<string, unknown>
      : {};
  const formats = Array.isArray(artifactRecord['format'])
    ? artifactRecord['format'].map((value) => String(value))
    : [];
  if (!formats.includes('mp4') || !formats.includes('webm')) {
    errors.push('artifact_requirements.format must include both mp4 and webm');
  }
  if (artifactRecord['minimum_resolution'] !== '1280x720') {
    errors.push('artifact_requirements.minimum_resolution must be 1280x720');
  }
  if (artifactRecord['minimum_duration_seconds'] !== 6) {
    errors.push('artifact_requirements.minimum_duration_seconds must be 6');
  }
  return errors;
}
