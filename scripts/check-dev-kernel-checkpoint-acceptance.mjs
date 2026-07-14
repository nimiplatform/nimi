#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  canonicalJson,
  captureRuntimeBuildSource,
  fileSha256,
  validateRuntimeBuildRecord,
} from './lib/runtime-build-record.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, '..');
const schemaPath = path.join(repoRoot, '.nimi/contracts/acceptance.schema.yaml');

const SHA256_RE = /^[0-9a-f]{64}$/u;
const GIT_HEAD_RE = /^[0-9a-f]{40}$/u;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const REQUIRED_CLOSE_LEVEL = 'dev_kernel_checkpoint';
const EVIDENCE_SCHEMA_ID = 'nimi.repository.candidate-evidence.v2';
const EXECUTION_OBSERVATION_SCHEMA_ID = 'nimi.repository.execution-observation.v1';
const JOURNEY_RESULT_SCHEMA_ID = 'nimi.local-agent-product-journey-result/v2';
const ARTIFACT_MANIFEST_SCHEMA_ID = 'nimi.local-agent-product-artifact-manifest/v2';

const EXPECTED_REQUIRED_ROWS = [
  'A-01', 'A-03', 'A-04', 'A-05', 'A-06', 'A-09',
  'C-03', 'C-04', 'C-06', 'C-08', 'C-09',
  'D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-08', 'D-09',
  'E-01a', 'E-03', 'E-04a', 'E-05', 'E-07', 'E-08', 'E-09',
  'F-01', 'F-02', 'F-03a', 'F-04a', 'F-06a',
  'H-01', 'H-02', 'H-03', 'H-04', 'H-05',
];

const EXPECTED_CLOSE_LEVELS = new Map([
  ['dev_kernel_checkpoint', 'checkpoint'],
  ['windows_platform_reference_close', 'platform'],
  ['app_migration_close', 'app'],
  ['ecosystem_hardcut_close', 'ecosystem'],
]);

const TOP_LEVEL_KEYS = [
  'schemaId',
  'manifestVersion',
  'closeLevel',
  'releasePosture',
  'productClosePromotion',
  'candidateBindingSha256',
  'candidate',
  'packageIdentity',
  'signingIdentity',
  'developmentServiceSignature',
  'evidence',
  'acceptanceRows',
];

const CANDIDATE_KEYS = [
  'candidateId',
  'repositories',
  'runtime',
  'builds',
  'configuration',
  'principals',
  'artifacts',
];

const REQUIRED_BUILD_COMPONENTS = ['runtime', 'sdk', 'kit', 'desktop', 'zhiyu', 'app-tools'];
const REQUIRED_ARTIFACT_IDS = [
  'runtime-service-binary',
  'proto-generated',
  'sdk-distribution',
  'kit-distribution',
  'desktop-shell',
  'zhiyu-electron',
  'app-tools',
];

const BUILD_ARTIFACT_MAP = new Map([
  ['runtime', 'runtime-service-binary'],
  ['sdk', 'sdk-distribution'],
  ['kit', 'kit-distribution'],
  ['desktop', 'desktop-shell'],
  ['zhiyu', 'zhiyu-electron'],
  ['app-tools', 'app-tools'],
]);

const FORBIDDEN_WORKFLOW_TOKENS = new Set([
  'task', 'tasks', 'status', 'manager', 'worker', 'dispatch', 'continuation',
  'workflow', 'selectedtarget', 'queue', 'resume', 'resumption', 'completion',
  'heartbeat', 'assignment', 'assignee', 'subagent', 'scheduler', 'lifecycle',
]);

const FORBIDDEN_SECRET_TOKENS = new Set([
  'token', 'secret', 'password', 'passphrase', 'privatekey', 'credential',
  'authorization', 'bearer', 'apikey', 'refreshtoken', 'accesstoken',
]);

const TEXT_EVIDENCE_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.txt', '.log', '.md', '.html', '.htm', '.xml', '.csv', '.tsv',
]);

const EVIDENCE_RECORD_KEYS = [
  'schemaId',
  'evidenceId',
  'candidateBindingSha256',
  'evidenceKind',
  'claims',
  'executionBinding',
  'artifactRefs',
];
const EVIDENCE_CLAIM_KEYS = ['rowId', 'claimId'];
const EXECUTION_BINDING_KEYS = ['executionSetId', 'journeyTrialId', 'sourceStateDigest'];
const EVIDENCE_ARTIFACT_REF_KEYS = ['role', 'ref', 'sha256'];
const EXECUTION_OBSERVATION_KEYS = [
  'schemaId', 'executionSetId', 'journeyTrialId', 'sourceStateDigest', 'outcome',
];
const JOURNEY_RESULT_KEYS = [
  'schemaVersion', 'journeyTrialId', 'journeyId', 'tier', 'batch', 'repeatIndex',
  'sourceState', 'environmentIdentity', 'durationMs', 'checkpoints', 'leafResults',
  'artifacts', 'processProblems', 'privacy', 'outcome',
];
const RUNNER_ARTIFACT_MANIFEST_KEYS = ['schemaVersion', 'resultIdentity', 'privacy', 'files'];
const RUNNER_ARTIFACT_FILE_KEYS = ['path', 'sha256', 'bytes', 'privacyClass'];
const JOURNEY_ARTIFACT_KEYS = ['artifactId', 'path', 'sha256', 'bytes', 'privacyClass'];
const DEV_KERNEL_CORE_CHECKPOINTS = [
  'fixed-service-ready',
  'production-account-login',
  'developer-mode-enabled',
  'run-once-project-admitted',
  'zero-grant-session',
  'operation-denied-before-grant',
  'selected-operation-granted',
  'selected-runtime-agent-operation',
  'process-mismatch-denied',
  'grant-revoked-next-operation-denied',
  'remembered-project-admitted',
  'runtime-agent-conversation',
  'edit-build-process-replaced',
  'conversation-resumed-after-process-replacement',
  'mode-off-dormant',
  'remembered-project-reactivated',
  'fixed-service-restarted',
  'conversation-resumed-after-runtime-restart',
  'account-switch-invalidated',
  'project-revoked-next-operation-denied',
  'desktop-real-shell-acceptance',
  'zhiyu-real-shell-acceptance',
  'protected-carrier-privacy-closeout',
];
const DEV_KERNEL_CORE_ARTIFACTS = [
  'dev-kernel-journey-summary',
  'fixed-service-summary',
  'provider-capture-summary',
  'real-shell-dom-console-a11y',
  'process-summary',
  'journey-environment',
  'journey-checkpoint-proof',
];
const DEV_KERNEL_CORE_PROCESS_STARTS = {
  provider: 1,
  realm: 1,
  runtime: 1,
  desktop: 1,
  zhiyu: 1,
};

function issue(code, location, reason) {
  return { code, location, reason };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function computeConfigurationSha256(configuration) {
  if (!isPlainObject(configuration)) return '';
  const payload = {
    profileId: configuration.profileId,
    runtimeSha256: configuration.runtimeSha256,
    desktopSha256: configuration.desktopSha256,
    zhiyuSha256: configuration.zhiyuSha256,
  };
  return sha256(JSON.stringify(canonicalize(payload)));
}

export function computeCandidateBindingSha256(manifest) {
  const payload = {
    closeLevel: manifest?.closeLevel,
    releasePosture: manifest?.releasePosture,
    productClosePromotion: manifest?.productClosePromotion,
    candidate: manifest?.candidate,
    packageIdentity: manifest?.packageIdentity,
    signingIdentity: manifest?.signingIdentity,
    developmentServiceSignature: manifest?.developmentServiceSignature,
  };
  return sha256(JSON.stringify(canonicalize(payload)));
}

export function computeExecutionSetId(candidateBindingSha256, journeyTrialId, sourceStateDigest) {
  return sha256(JSON.stringify(canonicalize({
    candidateBindingSha256,
    journeyTrialId,
    sourceStateDigest,
  })));
}

function keyTokens(key) {
  const expanded = String(key)
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[^A-Za-z0-9]+/gu, ' ')
    .trim()
    .toLowerCase();
  const tokens = expanded ? expanded.split(/\s+/u) : [];
  tokens.push(expanded.replace(/\s+/gu, ''));
  return new Set(tokens);
}

function scanText(value, location, issues) {
  if (/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/iu.test(value)) {
    issues.push(issue('PRIVATE_KEY_MATERIAL_FORBIDDEN', location, 'Private-key material must never enter checkpoint evidence.'));
  }
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu.test(value)
      || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(value)
      || /\b(?:access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|password)\s*[:=]\s*\S+/iu.test(value)) {
    issues.push(issue('SECRET_OR_TOKEN_MATERIAL_FORBIDDEN', location, 'Secret or reusable token material must never enter checkpoint evidence.'));
  }
  if (/(?:^|[\s"'])(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|\\\\[^\\\s]+\\[^\\\s]+|\/(?:home|Users)\/|~[\\/])/iu.test(value)) {
    issues.push(issue('ABSOLUTE_USER_PATH_FORBIDDEN', location, 'Absolute user paths must not enter checkpoint evidence.'));
  }
  if (/2026-07-10-third-party-installed-app-reference-hardcut|\bWave[\s_-]*A\b/iu.test(value)) {
    issues.push(issue('OLD_WAVE_EVIDENCE_FORBIDDEN', location, 'Predecessor Wave A evidence cannot prove the successor checkpoint.'));
  }
}

function scanManifestObject(value, location, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanManifestObject(item, `${location}[${index}]`, issues));
    return;
  }
  if (!isPlainObject(value)) {
    if (typeof value === 'string') scanText(value, location, issues);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const tokens = keyTokens(key);
    if ([...tokens].some((token) => token.startsWith('waiv'))) {
      issues.push(issue('WAIVER_FIELD_FORBIDDEN', `${location}.${key}`, 'Checkpoint manifests cannot contain waiver fields.'));
    }
    if ([...tokens].some((token) => FORBIDDEN_WORKFLOW_TOKENS.has(token))) {
      issues.push(issue('WORKFLOW_FIELD_FORBIDDEN', `${location}.${key}`, 'Repository evidence cannot own or mirror workflow state.'));
    }
    if ([...tokens].some((token) => FORBIDDEN_SECRET_TOKENS.has(token))) {
      issues.push(issue('SECRET_FIELD_FORBIDDEN', `${location}.${key}`, 'Secret-bearing fields are forbidden even when empty.'));
    }
    scanManifestObject(child, `${location}.${key}`, issues);
  }
}

function scanSensitiveObject(value, location, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitiveObject(item, `${location}[${index}]`, issues));
    return;
  }
  if (!isPlainObject(value)) {
    if (typeof value === 'string') scanText(value, location, issues);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const tokens = keyTokens(key);
    if ([...tokens].some((token) => FORBIDDEN_SECRET_TOKENS.has(token))) {
      issues.push(issue('SECRET_FIELD_FORBIDDEN', `${location}.${key}`, 'Secret-bearing fields are forbidden even when empty.'));
    }
    scanSensitiveObject(child, `${location}.${key}`, issues);
  }
}

function expectObject(value, location, issues) {
  if (isPlainObject(value)) return true;
  issues.push(issue('OBJECT_REQUIRED', location, 'Expected an object.'));
  return false;
}

function expectArray(value, location, issues) {
  if (Array.isArray(value)) return true;
  issues.push(issue('ARRAY_REQUIRED', location, 'Expected an array.'));
  return false;
}

function expectExactKeys(value, expectedKeys, location, issues) {
  if (!expectObject(value, location, issues)) return false;
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) issues.push(issue('REQUIRED_FIELD_MISSING', `${location}.${key}`, 'Required field is missing.'));
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(issue('UNEXPECTED_FIELD', `${location}.${key}`, 'Field is not part of the static close-manifest contract.'));
  }
  return true;
}

function expectNonEmptyString(value, location, issues) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(issue('NON_EMPTY_STRING_REQUIRED', location, 'Expected a non-empty string.'));
    return false;
  }
  return true;
}

function expectSha256(value, location, issues) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    issues.push(issue('SHA256_REQUIRED', location, 'Expected a lowercase SHA-256 digest.'));
    return false;
  }
  return true;
}

function expectEnum(value, expected, location, code, issues) {
  if (!expected.includes(value)) {
    issues.push(issue(code, location, `Expected ${expected.map((item) => JSON.stringify(item)).join(' or ')}.`));
    return false;
  }
  return true;
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((item) => actual.includes(item));
}

function validateEvidencePolicySchema(checkpoint, issues) {
  const location = '.nimi/contracts/acceptance.schema.yaml#dev_kernel_checkpoint';
  const evidenceRecord = checkpoint?.evidence_record;
  if (!isPlainObject(evidenceRecord)) {
    issues.push(issue('EVIDENCE_POLICY_SCHEMA_MISSING', location, 'Candidate-evidence v2 policy is required.'));
    return null;
  }
  if (evidenceRecord.schema_id !== EVIDENCE_SCHEMA_ID
      || JSON.stringify(evidenceRecord.exact_keys) !== JSON.stringify(EVIDENCE_RECORD_KEYS)
      || JSON.stringify(evidenceRecord.claim_exact_keys) !== JSON.stringify(EVIDENCE_CLAIM_KEYS)
      || JSON.stringify(evidenceRecord.artifact_ref_exact_keys) !== JSON.stringify(EVIDENCE_ARTIFACT_REF_KEYS)) {
    issues.push(issue('EVIDENCE_RECORD_SCHEMA_DRIFT', `${location}.evidence_record`, 'Candidate-evidence v2 fields drifted.'));
  }
  const evidenceKinds = evidenceRecord.evidence_kind_enum;
  if (!Array.isArray(evidenceKinds) || evidenceKinds.length === 0 || new Set(evidenceKinds).size !== evidenceKinds.length
      || evidenceKinds.includes('closeout')) {
    issues.push(issue('EVIDENCE_KIND_POLICY_INVALID', `${location}.evidence_record.evidence_kind_enum`, 'Evidence kinds must be a non-empty closed set without generic closeout.'));
  }
  const execution = evidenceRecord.execution_binding;
  if (!isPlainObject(execution)
      || execution.algorithm !== 'sha256'
      || JSON.stringify(execution.canonical_payload_keys) !== JSON.stringify(['candidateBindingSha256', 'journeyTrialId', 'sourceStateDigest'])
      || JSON.stringify(execution.exact_keys) !== JSON.stringify(EXECUTION_BINDING_KEYS)
      || execution.shared_across_all_required_execution_claims !== true) {
    issues.push(issue('EXECUTION_BINDING_POLICY_INVALID', `${location}.evidence_record.execution_binding`, 'Execution binding must be recomputable and shared by every execution claim.'));
  }
  if (!sameStringSet(evidenceRecord.artifact_role_enum, ['observation', 'execution_observation', 'runner_result', 'runner_artifact_manifest'])) {
    issues.push(issue('EVIDENCE_ARTIFACT_ROLE_POLICY_INVALID', `${location}.evidence_record.artifact_role_enum`, 'Evidence artifact roles drifted.'));
  }
  const executionObservation = evidenceRecord.execution_observation;
  if (!isPlainObject(executionObservation)
      || executionObservation.schema_id !== EXECUTION_OBSERVATION_SCHEMA_ID
      || JSON.stringify(executionObservation.exact_keys) !== JSON.stringify(EXECUTION_OBSERVATION_KEYS)
      || executionObservation.required_outcome !== 'passed') {
    issues.push(issue('EXECUTION_OBSERVATION_POLICY_INVALID', `${location}.evidence_record.execution_observation`, 'Execution observations must bind the exact passing execution tuple.'));
  }

  const runnerProfile = checkpoint?.runner_profiles?.dev_kernel_core_v2;
  if (!isPlainObject(runnerProfile)
      || runnerProfile.result_schema_id !== JOURNEY_RESULT_SCHEMA_ID
      || runnerProfile.artifact_manifest_schema_id !== ARTIFACT_MANIFEST_SCHEMA_ID
      || runnerProfile.journey_id !== 'dev-kernel-core'
      || runnerProfile.tier !== 'L2'
      || runnerProfile.batch !== 'core'
      || JSON.stringify(canonicalize(runnerProfile.exact_process_starts)) !== JSON.stringify(canonicalize(DEV_KERNEL_CORE_PROCESS_STARTS))
      || JSON.stringify(runnerProfile.exact_required_checkpoints) !== JSON.stringify(DEV_KERNEL_CORE_CHECKPOINTS)
      || JSON.stringify(runnerProfile.required_artifact_ids) !== JSON.stringify(DEV_KERNEL_CORE_ARTIFACTS)
      || runnerProfile.minimum_shell_screenshot_artifacts !== 2) {
    issues.push(issue('DEV_KERNEL_RUNNER_PROFILE_DRIFT', `${location}.runner_profiles.dev_kernel_core_v2`, 'The dev-kernel-core v2 recursive validation profile drifted.'));
  }

  const policies = checkpoint?.row_evidence_policy;
  if (!isPlainObject(policies) || !sameStringSet(Object.keys(policies), EXPECTED_REQUIRED_ROWS)) {
    issues.push(issue('ROW_EVIDENCE_POLICY_SET_INVALID', `${location}.row_evidence_policy`, 'Every and only required checkpoint row needs an evidence policy.'));
    return { evidenceKinds: Array.isArray(evidenceKinds) ? evidenceKinds : [], policies: {}, runnerProfiles: checkpoint?.runner_profiles ?? {} };
  }
  for (const rowId of EXPECTED_REQUIRED_ROWS) {
    const rowPolicy = policies[rowId];
    const rowLocation = `${location}.row_evidence_policy.${rowId}`;
    if (!expectExactKeys(rowPolicy, ['required_claims'], rowLocation, issues)
        || !expectArray(rowPolicy.required_claims, `${rowLocation}.required_claims`, issues)) continue;
    if (rowPolicy.required_claims.length === 0) {
      issues.push(issue('ROW_REQUIRED_CLAIM_MISSING', `${rowLocation}.required_claims`, 'Each required row needs at least one semantic claim.'));
    }
    const claimIds = new Set();
    for (const [index, claim] of rowPolicy.required_claims.entries()) {
      const claimLocation = `${rowLocation}.required_claims[${index}]`;
      if (!expectExactKeys(claim, ['claim_id', 'allowed_evidence_kinds', 'execution_binding', 'runner_profile'], claimLocation, issues)) continue;
      if (expectNonEmptyString(claim.claim_id, `${claimLocation}.claim_id`, issues)) {
        if (claimIds.has(claim.claim_id)) issues.push(issue('DUPLICATE_ROW_REQUIRED_CLAIM', `${claimLocation}.claim_id`, 'Required claim ids must be unique within a row.'));
        claimIds.add(claim.claim_id);
      }
      if (!expectArray(claim.allowed_evidence_kinds, `${claimLocation}.allowed_evidence_kinds`, issues)
          || claim.allowed_evidence_kinds.length === 0
          || claim.allowed_evidence_kinds.some((kind) => !evidenceKinds?.includes(kind))) {
        issues.push(issue('ROW_ALLOWED_EVIDENCE_KIND_INVALID', `${claimLocation}.allowed_evidence_kinds`, 'Claim evidence kinds must be non-empty members of the closed evidence-kind set.'));
      }
      expectEnum(claim.execution_binding, ['required', 'forbidden'], `${claimLocation}.execution_binding`, 'ROW_EXECUTION_BINDING_POLICY_INVALID', issues);
      if (claim.runner_profile !== null && !isPlainObject(checkpoint?.runner_profiles?.[claim.runner_profile])) {
        issues.push(issue('ROW_RUNNER_PROFILE_UNKNOWN', `${claimLocation}.runner_profile`, 'Claim references an unknown runner validation profile.'));
      }
      if (claim.runner_profile !== null && claim.execution_binding !== 'required') {
        issues.push(issue('ROW_RUNNER_PROFILE_REQUIRES_EXECUTION', claimLocation, 'Runner-backed claims must require execution binding.'));
      }
    }
  }
  const f04a = policies['F-04a']?.required_claims;
  if (!Array.isArray(f04a) || f04a.length !== 1
      || f04a[0]?.claim_id !== 'journey.dev_kernel_core_real_shell_passed'
      || JSON.stringify(f04a[0]?.allowed_evidence_kinds) !== JSON.stringify(['local_agent_journey'])
      || f04a[0]?.execution_binding !== 'required'
      || f04a[0]?.runner_profile !== 'dev_kernel_core_v2') {
    issues.push(issue('F04A_RUNNER_POLICY_INVALID', `${location}.row_evidence_policy.F-04a`, 'F-04a must require the real dev-kernel-core v2 LocalAgent journey.'));
  }
  return {
    evidenceKinds: Array.isArray(evidenceKinds) ? evidenceKinds : [],
    policies,
    runnerProfiles: checkpoint.runner_profiles,
  };
}

function validateSchema(schema, issues) {
  if (!isPlainObject(schema)) {
    issues.push(issue('ACCEPTANCE_SCHEMA_INVALID', '.nimi/contracts/acceptance.schema.yaml', 'Acceptance schema must be an object.'));
    return null;
  }
  if (schema.id !== 'nimi-coding.acceptance.v1' || schema.kind !== 'acceptance') {
    issues.push(issue('NIMICODING_ACCEPTANCE_PROJECTION_CHANGED', '.nimi/contracts/acceptance.schema.yaml', 'Retained nimicoding acceptance identity was not preserved.'));
  }
  const requiredBlocks = schema.required_blocks;
  if (!Array.isArray(requiredBlocks)
      || ['Findings', 'Authority Alignment', 'Evidence Sufficiency', 'Disposition'].some((item) => !requiredBlocks.includes(item))) {
    issues.push(issue('NIMICODING_ACCEPTANCE_BLOCKS_CHANGED', '.nimi/contracts/acceptance.schema.yaml', 'Retained nimicoding acceptance blocks were not preserved.'));
  }
  const contract = schema.repository_static_close_manifest;
  if (!isPlainObject(contract) || contract.id !== 'nimi.repository.static-close-manifest.v1') {
    issues.push(issue('STATIC_CLOSE_CONTRACT_MISSING', '.nimi/contracts/acceptance.schema.yaml', 'Repository static close-manifest contract is missing.'));
    return null;
  }
  if (contract.repository_role !== 'static_candidate_and_evidence_validation_only'
      || contract.host_control_boundary !== 'external_ai_host_exclusive') {
    issues.push(issue('STATIC_CLOSE_WORKFLOW_BOUNDARY_INVALID', '.nimi/contracts/acceptance.schema.yaml', 'Static validation must not own workflow state.'));
  }
  const profiles = contract.close_level_profiles;
  for (const [level, category] of EXPECTED_CLOSE_LEVELS) {
    if (!isPlainObject(profiles?.[level]) || profiles[level].category !== category) {
      issues.push(issue('CLOSE_LEVEL_PROFILE_MISSING', `.nimi/contracts/acceptance.schema.yaml#${level}`, `Missing ${category} close-level profile.`));
    }
  }
  const schemaRows = contract.dev_kernel_checkpoint?.exact_required_rows;
  if (!Array.isArray(schemaRows) || JSON.stringify(schemaRows) !== JSON.stringify(EXPECTED_REQUIRED_ROWS)) {
    issues.push(issue('DEV_KERNEL_REQUIRED_ROWS_SCHEMA_DRIFT', '.nimi/contracts/acceptance.schema.yaml#dev_kernel_checkpoint', 'Required checkpoint row set/order drifted.'));
  }
  if (JSON.stringify(contract.top_level_required_keys) !== JSON.stringify(TOP_LEVEL_KEYS)) {
    issues.push(issue('STATIC_CLOSE_TOP_LEVEL_SCHEMA_DRIFT', '.nimi/contracts/acceptance.schema.yaml', 'Top-level manifest field set drifted.'));
  }
  if (JSON.stringify(contract.dev_kernel_checkpoint?.required_build_components) !== JSON.stringify(REQUIRED_BUILD_COMPONENTS)
      || JSON.stringify(contract.dev_kernel_checkpoint?.required_artifact_ids) !== JSON.stringify(REQUIRED_ARTIFACT_IDS)) {
    issues.push(issue('DEV_KERNEL_CANDIDATE_COMPONENT_SCHEMA_DRIFT', '.nimi/contracts/acceptance.schema.yaml#dev_kernel_checkpoint', 'Required build/artifact binding set drifted.'));
  }
  contract.validatedEvidencePolicy = validateEvidencePolicySchema(contract.dev_kernel_checkpoint, issues);
  return contract;
}

function validateRepositoryBindings(repositories, issues) {
  if (!expectArray(repositories, 'manifest.candidate.repositories', issues)) return;
  if (repositories.length === 0) issues.push(issue('REPOSITORY_BINDING_REQUIRED', 'manifest.candidate.repositories', 'At least the nimi repository must be bound.'));
  const ids = new Set();
  for (const [index, repository] of repositories.entries()) {
    const location = `manifest.candidate.repositories[${index}]`;
    if (!expectExactKeys(repository, ['repoId', 'headCommit', 'dirty', 'dirtyDiffSha256'], location, issues)) continue;
    if (expectNonEmptyString(repository.repoId, `${location}.repoId`, issues)) {
      if (ids.has(repository.repoId)) issues.push(issue('DUPLICATE_REPOSITORY_BINDING', `${location}.repoId`, 'Repository ids must be unique.'));
      ids.add(repository.repoId);
    }
    if (typeof repository.headCommit !== 'string' || !GIT_HEAD_RE.test(repository.headCommit)) {
      issues.push(issue('GIT_HEAD_REQUIRED', `${location}.headCommit`, 'Expected an exact lowercase 40-character Git head.'));
    }
    if (typeof repository.dirty !== 'boolean') issues.push(issue('DIRTY_DECLARATION_REQUIRED', `${location}.dirty`, 'Dirty state must be an explicit boolean.'));
    if (expectSha256(repository.dirtyDiffSha256, `${location}.dirtyDiffSha256`, issues)) {
      if (repository.dirty === false && repository.dirtyDiffSha256 !== EMPTY_SHA256) {
        issues.push(issue('CLEAN_DIFF_HASH_INVALID', `${location}.dirtyDiffSha256`, 'A clean repository must bind the SHA-256 of an empty diff.'));
      }
      if (repository.dirty === true && repository.dirtyDiffSha256 === EMPTY_SHA256) {
        issues.push(issue('DIRTY_DIFF_HASH_INVALID', `${location}.dirtyDiffSha256`, 'A dirty repository cannot bind the empty diff digest.'));
      }
    }
  }
  if (!ids.has('nimi')) issues.push(issue('NIMI_REPOSITORY_BINDING_MISSING', 'manifest.candidate.repositories', 'The nimi repository head and dirty diff must be bound.'));
}

function validateRuntimeBinding(runtime, configuration, artifactById, issues) {
  const location = 'manifest.candidate.runtime';
  if (!expectExactKeys(runtime, ['buildId', 'binarySha256', 'configurationSha256', 'service'], location, issues)) return;
  expectNonEmptyString(runtime.buildId, `${location}.buildId`, issues);
  expectSha256(runtime.binarySha256, `${location}.binarySha256`, issues);
  expectSha256(runtime.configurationSha256, `${location}.configurationSha256`, issues);
  const serviceLocation = `${location}.service`;
  if (!expectExactKeys(runtime.service, [
    'name', 'kind', 'principal', 'accountSid', 'serviceSidType', 'startType', 'interactive',
    'binarySha256', 'configurationSha256', 'dataRootIdentitySha256',
  ], serviceLocation, issues)) return;
  expectNonEmptyString(runtime.service.name, `${serviceLocation}.name`, issues);
  expectEnum(runtime.service.kind, ['fixed_windows_service'], `${serviceLocation}.kind`, 'FIXED_SERVICE_KIND_REQUIRED', issues);
  expectEnum(runtime.service.principal, ['LocalSystem'], `${serviceLocation}.principal`, 'FIXED_SERVICE_PRINCIPAL_REQUIRED', issues);
  expectEnum(runtime.service.accountSid, ['S-1-5-18'], `${serviceLocation}.accountSid`, 'FIXED_SERVICE_SID_REQUIRED', issues);
  expectEnum(runtime.service.serviceSidType, ['restricted'], `${serviceLocation}.serviceSidType`, 'FIXED_SERVICE_SID_TYPE_REQUIRED', issues);
  expectEnum(runtime.service.startType, ['automatic'], `${serviceLocation}.startType`, 'FIXED_SERVICE_START_TYPE_REQUIRED', issues);
  if (runtime.service.interactive !== false) issues.push(issue('INTERACTIVE_SERVICE_FORBIDDEN', `${serviceLocation}.interactive`, 'Fixed Runtime service must be non-interactive.'));
  expectSha256(runtime.service.binarySha256, `${serviceLocation}.binarySha256`, issues);
  expectSha256(runtime.service.configurationSha256, `${serviceLocation}.configurationSha256`, issues);
  expectSha256(runtime.service.dataRootIdentitySha256, `${serviceLocation}.dataRootIdentitySha256`, issues);
  if (runtime.service.binarySha256 !== runtime.binarySha256) {
    issues.push(issue('SERVICE_RUNTIME_BINARY_MISMATCH', `${serviceLocation}.binarySha256`, 'Installed service binary must equal the Runtime candidate binary.'));
  }
  if (runtime.service.configurationSha256 !== runtime.configurationSha256) {
    issues.push(issue('SERVICE_RUNTIME_CONFIG_MISMATCH', `${serviceLocation}.configurationSha256`, 'Installed service configuration must equal the Runtime candidate configuration.'));
  }
  if (configuration?.runtimeSha256 !== runtime.configurationSha256) {
    issues.push(issue('RUNTIME_CONFIGURATION_BINDING_MISMATCH', `${location}.configurationSha256`, 'Runtime configuration must match the aggregate candidate configuration record.'));
  }
  if (artifactById.get('runtime-service-binary')?.sha256 !== runtime.binarySha256) {
    issues.push(issue('RUNTIME_ARTIFACT_BINDING_MISMATCH', `${location}.binarySha256`, 'Runtime binary must match the runtime-service-binary artifact hash.'));
  }
}

function validateBuilds(builds, runtime, artifactById, issues) {
  if (!expectArray(builds, 'manifest.candidate.builds', issues)) return;
  const components = new Map();
  for (const [index, build] of builds.entries()) {
    const location = `manifest.candidate.builds[${index}]`;
    if (!expectExactKeys(build, ['component', 'buildId', 'artifactSha256'], location, issues)) continue;
    if (expectNonEmptyString(build.component, `${location}.component`, issues)) {
      if (components.has(build.component)) issues.push(issue('DUPLICATE_BUILD_COMPONENT', `${location}.component`, 'Build components must be unique.'));
      components.set(build.component, build);
    }
    expectNonEmptyString(build.buildId, `${location}.buildId`, issues);
    expectSha256(build.artifactSha256, `${location}.artifactSha256`, issues);
  }
  for (const component of REQUIRED_BUILD_COMPONENTS) {
    if (!components.has(component)) issues.push(issue('REQUIRED_BUILD_COMPONENT_MISSING', 'manifest.candidate.builds', `Missing ${component} build binding.`));
  }
  for (const [component, artifactId] of BUILD_ARTIFACT_MAP) {
    const build = components.get(component);
    const artifact = artifactById.get(artifactId);
    if (build && artifact && build.artifactSha256 !== artifact.sha256) {
      issues.push(issue('BUILD_ARTIFACT_HASH_MISMATCH', `manifest.candidate.builds.${component}`, `${component} build and ${artifactId} artifact hashes differ.`));
    }
  }
  if (components.get('runtime')?.buildId !== runtime?.buildId) {
    issues.push(issue('RUNTIME_BUILD_ID_MISMATCH', 'manifest.candidate.builds.runtime', 'Runtime build id must match the Runtime binding.'));
  }
}

function validateConfiguration(configuration, issues) {
  const location = 'manifest.candidate.configuration';
  if (!expectExactKeys(configuration, ['profileId', 'aggregateSha256', 'runtimeSha256', 'desktopSha256', 'zhiyuSha256'], location, issues)) return;
  expectNonEmptyString(configuration.profileId, `${location}.profileId`, issues);
  expectSha256(configuration.aggregateSha256, `${location}.aggregateSha256`, issues);
  expectSha256(configuration.runtimeSha256, `${location}.runtimeSha256`, issues);
  expectSha256(configuration.desktopSha256, `${location}.desktopSha256`, issues);
  expectSha256(configuration.zhiyuSha256, `${location}.zhiyuSha256`, issues);
  const computed = computeConfigurationSha256(configuration);
  if (configuration.aggregateSha256 !== computed) {
    issues.push(issue('CONFIGURATION_AGGREGATE_HASH_MISMATCH', `${location}.aggregateSha256`, `Expected ${computed}.`));
  }
}

function validateArtifacts(artifacts, issues) {
  const artifactById = new Map();
  if (!expectArray(artifacts, 'manifest.candidate.artifacts', issues)) return artifactById;
  for (const [index, artifact] of artifacts.entries()) {
    const location = `manifest.candidate.artifacts[${index}]`;
    if (!expectExactKeys(artifact, ['artifactId', 'sha256'], location, issues)) continue;
    if (expectNonEmptyString(artifact.artifactId, `${location}.artifactId`, issues)) {
      if (artifactById.has(artifact.artifactId)) issues.push(issue('DUPLICATE_ARTIFACT_ID', `${location}.artifactId`, 'Artifact ids must be unique.'));
      artifactById.set(artifact.artifactId, artifact);
    }
    expectSha256(artifact.sha256, `${location}.sha256`, issues);
  }
  for (const artifactId of REQUIRED_ARTIFACT_IDS) {
    if (!artifactById.has(artifactId)) issues.push(issue('REQUIRED_ARTIFACT_MISSING', 'manifest.candidate.artifacts', `Missing ${artifactId} artifact hash.`));
  }
  return artifactById;
}

function validatePrincipals(principals, buildIds, issues) {
  const location = 'manifest.candidate.principals';
  if (!expectArray(principals, location, issues)) return;
  if (principals.length === 0) issues.push(issue('LOCAL_DEVELOPMENT_PRINCIPAL_REQUIRED', location, 'At least one live local_development principal trace is required.'));
  const ids = new Set();
  for (const [index, principal] of principals.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (!expectExactKeys(principal, [
      'principalId', 'localOsUserAnchorSha256', 'accountBindingSha256', 'provenance',
      'recordRevision', 'grantRevision', 'leaseId', 'processId', 'sessionId', 'buildId',
      'executionProfileRef', 'hostExecutableSha256', 'payloadRootSha256',
    ], itemLocation, issues)) continue;
    if (expectNonEmptyString(principal.principalId, `${itemLocation}.principalId`, issues)) {
      if (ids.has(principal.principalId)) issues.push(issue('DUPLICATE_PRINCIPAL_ID', `${itemLocation}.principalId`, 'Principal ids must be unique.'));
      ids.add(principal.principalId);
    }
    expectSha256(principal.localOsUserAnchorSha256, `${itemLocation}.localOsUserAnchorSha256`, issues);
    expectSha256(principal.accountBindingSha256, `${itemLocation}.accountBindingSha256`, issues);
    expectEnum(principal.provenance, ['local_development'], `${itemLocation}.provenance`, 'LOCAL_DEVELOPMENT_PROVENANCE_REQUIRED', issues);
    for (const field of ['recordRevision', 'grantRevision', 'processId']) {
      if (!Number.isInteger(principal[field]) || principal[field] < 1) {
        issues.push(issue('POSITIVE_INTEGER_REQUIRED', `${itemLocation}.${field}`, 'Expected a positive integer.'));
      }
    }
    for (const field of ['leaseId', 'sessionId', 'buildId', 'executionProfileRef']) {
      expectNonEmptyString(principal[field], `${itemLocation}.${field}`, issues);
    }
    expectSha256(principal.hostExecutableSha256, `${itemLocation}.hostExecutableSha256`, issues);
    expectSha256(principal.payloadRootSha256, `${itemLocation}.payloadRootSha256`, issues);
    if (!buildIds.has(principal.buildId)) issues.push(issue('PRINCIPAL_BUILD_BINDING_MISSING', `${itemLocation}.buildId`, 'Principal trace build id is absent from candidate builds.'));
  }
}

function validateNotApplicableIdentity(identity, location, reasonPattern, issues) {
  if (!expectExactKeys(identity, ['applicability', 'reason'], location, issues)) return;
  expectEnum(identity.applicability, ['not_applicable'], `${location}.applicability`, 'DEV_CHECKPOINT_IDENTITY_MUST_BE_NOT_APPLICABLE', issues);
  if (expectNonEmptyString(identity.reason, `${location}.reason`, issues)) {
    if (identity.reason.trim().length < 24 || !reasonPattern.test(identity.reason)) {
      issues.push(issue('NOT_APPLICABLE_REASON_INSUFFICIENT', `${location}.reason`, 'Reason must identify the dev-only/0P package boundary.'));
    }
  }
}

function validateDevelopmentServiceSignature(signature, runtime, issues) {
  const location = 'manifest.developmentServiceSignature';
  if (!expectExactKeys(signature, ['kind', 'certificateFingerprintSha256', 'signedArtifactSha256'], location, issues)) return;
  expectEnum(signature.kind, ['development_windows_service_authenticode'], `${location}.kind`, 'DEV_SERVICE_SIGNATURE_KIND_INVALID', issues);
  expectSha256(signature.certificateFingerprintSha256, `${location}.certificateFingerprintSha256`, issues);
  expectSha256(signature.signedArtifactSha256, `${location}.signedArtifactSha256`, issues);
  if (signature.signedArtifactSha256 !== runtime?.binarySha256) {
    issues.push(issue('DEV_SERVICE_SIGNATURE_ARTIFACT_MISMATCH', `${location}.signedArtifactSha256`, 'Development service signature must bind the Runtime service binary.'));
  }
}

function validateCandidate(candidate, issues) {
  if (!expectExactKeys(candidate, CANDIDATE_KEYS, 'manifest.candidate', issues)) return;
  if (expectNonEmptyString(candidate.candidateId, 'manifest.candidate.candidateId', issues)
      && !/^[a-z0-9][a-z0-9._-]{7,127}$/u.test(candidate.candidateId)) {
    issues.push(issue('CANDIDATE_ID_INVALID', 'manifest.candidate.candidateId', 'Candidate id must be an opaque lowercase identifier.'));
  }
  validateRepositoryBindings(candidate.repositories, issues);
  validateConfiguration(candidate.configuration, issues);
  const artifactById = validateArtifacts(candidate.artifacts, issues);
  validateRuntimeBinding(candidate.runtime, candidate.configuration, artifactById, issues);
  validateBuilds(candidate.builds, candidate.runtime, artifactById, issues);
  const buildIds = new Set(Array.isArray(candidate.builds) ? candidate.builds.map((item) => item?.buildId).filter(Boolean) : []);
  validatePrincipals(candidate.principals, buildIds, issues);
}

export function validateLiveDevKernelCandidateBindings(manifest, live) {
  const issues = [];
  const repository = Array.isArray(manifest?.candidate?.repositories)
    ? manifest.candidate.repositories.find((item) => item?.repoId === 'nimi')
    : null;
  const source = live?.source;
  const buildRecord = live?.buildRecord;
  const runtime = manifest?.candidate?.runtime;
  const runtimeBuild = Array.isArray(manifest?.candidate?.builds)
    ? manifest.candidate.builds.find((item) => item?.component === 'runtime')
    : null;
  if (!repository || !source) {
    issues.push(issue('LIVE_REPOSITORY_SOURCE_REQUIRED', 'manifest.candidate.repositories', 'Admissible checkpoint validation requires the live nimi source descriptor.'));
  } else if (repository.headCommit !== source.headCommit
      || repository.dirty !== source.dirty
      || repository.dirtyDiffSha256 !== source.trackedDiffSha256) {
    issues.push(issue('LIVE_REPOSITORY_BINDING_MISMATCH', 'manifest.candidate.repositories.nimi', 'Manifest repository head, dirty state, and tracked diff must equal the live nimi source.'));
  }
  if (!buildRecord || !source) {
    issues.push(issue('LIVE_RUNTIME_BUILD_RECORD_REQUIRED', 'dist/nimi-build-record.json', 'Admissible checkpoint validation requires the current Runtime build record.'));
    return issues;
  }
  if (canonicalJson(buildRecord.source) !== canonicalJson(source)) {
    issues.push(issue('LIVE_SOURCE_STATE_MISMATCH', 'dist/nimi-build-record.json.source', 'Runtime build source no longer equals the live repository source, including untracked files and source-tree digest.'));
  }
  if (manifest?.candidate?.candidateId !== buildRecord.candidateId
      || runtime?.buildId !== buildRecord.candidateId
      || runtimeBuild?.buildId !== buildRecord.candidateId) {
    issues.push(issue('LIVE_RUNTIME_CANDIDATE_ID_MISMATCH', 'manifest.candidate', 'Manifest candidate and Runtime build ids must equal the live Runtime build record candidate id.'));
  }
  if (runtime?.binarySha256 !== buildRecord.runtime?.binarySha256
      || runtimeBuild?.artifactSha256 !== buildRecord.runtime?.binarySha256
      || live.runtimeBinarySha256 !== buildRecord.runtime?.binarySha256) {
    issues.push(issue('LIVE_RUNTIME_BINARY_MISMATCH', 'manifest.candidate.runtime.binarySha256', 'Manifest, dist binary, and Runtime build record binary hashes must be identical.'));
  }
  if (manifest?.developmentServiceSignature?.certificateFingerprintSha256 !== buildRecord.runtime?.signerCertificateSha256) {
    issues.push(issue('LIVE_RUNTIME_SIGNER_MISMATCH', 'manifest.developmentServiceSignature.certificateFingerprintSha256', 'Manifest development signer must equal the Runtime build record signer.'));
  }
  return issues;
}

async function validateLiveDevKernelCandidate(manifest, issues) {
  const buildRecordPath = path.join(repoRoot, 'dist', 'nimi-build-record.json');
  const runtimeBinaryPath = path.join(repoRoot, 'dist', 'nimi.exe');
  let source;
  let buildRecord;
  let runtimeBinarySha256;
  try {
    source = captureRuntimeBuildSource(repoRoot);
  } catch (error) {
    issues.push(issue('LIVE_SOURCE_CAPTURE_FAILED', 'repository', `Unable to capture live repository source: ${error.message}`));
    return;
  }
  try {
    buildRecord = JSON.parse(await fs.readFile(buildRecordPath, 'utf8'));
    runtimeBinarySha256 = fileSha256(runtimeBinaryPath);
    validateRuntimeBuildRecord(buildRecord, {
      source,
      runtimeBinarySha256,
      signerCertificateSha256: buildRecord?.runtime?.signerCertificateSha256,
      requireDevKernel: true,
    });
  } catch (error) {
    issues.push(issue('LIVE_RUNTIME_BUILD_RECORD_INVALID', 'dist/nimi-build-record.json', `Live Runtime build record or binary is unavailable, stale, or invalid: ${error.message}`));
  }
  issues.push(...validateLiveDevKernelCandidateBindings(manifest, {
    source,
    buildRecord,
    runtimeBinarySha256,
  }));
}

function validateRelativeRef(ref, location, issues) {
  if (!expectNonEmptyString(ref, location, issues)) return false;
  if (ref.includes('\\') || path.posix.isAbsolute(ref) || /^[A-Za-z]:[\\/]/u.test(ref)
      || ref.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    issues.push(issue('RELATIVE_EVIDENCE_REF_REQUIRED', location, 'Evidence refs must be normalized forward-slash paths inside the manifest evidence bundle.'));
    return false;
  }
  return true;
}

function resolveContained(baseDir, relative, location, issues) {
  const resolved = path.resolve(baseDir, ...relative.split('/'));
  const prefix = `${path.resolve(baseDir)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    issues.push(issue('EVIDENCE_REF_ESCAPES_BUNDLE', location, 'Evidence refs cannot escape their containing evidence bundle.'));
    return null;
  }
  return resolved;
}

async function readAndHash(target, location, issues) {
  try {
    const content = await fs.readFile(target);
    return { path: target, content, sha256: sha256(content) };
  } catch (error) {
    issues.push(issue('EVIDENCE_FILE_UNREADABLE', location, error.code === 'ENOENT' ? 'Evidence file does not exist.' : error.message));
    return null;
  }
}

function parseJsonBuffer(file, location, code, issues) {
  try {
    const value = JSON.parse(file.content.toString('utf8'));
    scanSensitiveObject(value, location, issues);
    return value;
  } catch {
    issues.push(issue(code, location, 'Expected valid JSON.'));
    return null;
  }
}

function validateZeroPrivacy(value, location, code, issues) {
  if (!isPlainObject(value) || value.ok !== true || !Array.isArray(value.findings) || value.findings.length !== 0) {
    issues.push(issue(code, location, 'Privacy must be ok=true with zero findings.'));
    return false;
  }
  return true;
}

function validateExecutionBinding(binding, candidateBinding, location, issues) {
  if (!expectExactKeys(binding, EXECUTION_BINDING_KEYS, location, issues)) return null;
  expectSha256(binding.executionSetId, `${location}.executionSetId`, issues);
  expectNonEmptyString(binding.journeyTrialId, `${location}.journeyTrialId`, issues);
  expectSha256(binding.sourceStateDigest, `${location}.sourceStateDigest`, issues);
  const expected = computeExecutionSetId(candidateBinding, binding.journeyTrialId, binding.sourceStateDigest);
  if (binding.executionSetId !== expected) issues.push(issue('EXECUTION_SET_ID_MISMATCH', `${location}.executionSetId`, `Expected ${expected}.`));
  return binding;
}

function normalizeRunnerRelativePath(value, location, issues) {
  if (!expectNonEmptyString(value, location, issues)) return null;
  const normalizedSlashes = value.replace(/\\/gu, '/');
  const normalized = path.posix.normalize(normalizedSlashes);
  if (path.posix.isAbsolute(normalizedSlashes) || /^[A-Za-z]:\//u.test(normalizedSlashes)
      || normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    issues.push(issue('RUNNER_ARTIFACT_PATH_INVALID', location, 'Runner artifact-manifest paths must remain relative to the result directory.'));
    return null;
  }
  return normalized;
}

function sameResolvedPath(left, right) {
  return path.resolve(left).replace(/\\/gu, '/').toLowerCase()
    === path.resolve(right).replace(/\\/gu, '/').toLowerCase();
}

function runnerArtifactPathMatches(resultPath, manifestRelativePath) {
  const normalizedResult = String(resultPath ?? '').replace(/\\/gu, '/');
  return normalizedResult === manifestRelativePath || normalizedResult.endsWith(`/${manifestRelativePath}`);
}

async function validateRunnerArtifactManifest({ artifactFile, resultArtifact, binding, profile, location, issues }) {
  const manifestLocation = `${location}.runner_artifact_manifest`;
  const manifest = parseJsonBuffer(artifactFile, manifestLocation, 'RUNNER_ARTIFACT_MANIFEST_JSON_INVALID', issues);
  if (!manifest) return null;
  expectExactKeys(manifest, RUNNER_ARTIFACT_MANIFEST_KEYS, manifestLocation, issues);
  if (manifest.schemaVersion !== profile.artifact_manifest_schema_id) issues.push(issue('RUNNER_ARTIFACT_MANIFEST_SCHEMA_INVALID', `${manifestLocation}.schemaVersion`, `Expected ${profile.artifact_manifest_schema_id}.`));
  if (manifest.resultIdentity !== binding?.journeyTrialId) issues.push(issue('RUNNER_ARTIFACT_RESULT_IDENTITY_MISMATCH', `${manifestLocation}.resultIdentity`, 'Artifact manifest does not bind the execution journey trial.'));
  validateZeroPrivacy(manifest.privacy, `${manifestLocation}.privacy`, 'RUNNER_ARTIFACT_PRIVACY_INVALID', issues);
  if (!expectArray(manifest.files, `${manifestLocation}.files`, issues)) return null;
  if (manifest.files.length < 2) issues.push(issue('RUNNER_ARTIFACT_FILES_INSUFFICIENT', `${manifestLocation}.files`, 'Artifact manifest must contain result.json and concrete evidence files.'));
  const manifestDir = path.dirname(artifactFile.path);
  const files = new Map();
  const resolvedFileIdentities = new Set();
  for (const [index, fileEntry] of manifest.files.entries()) {
    const fileLocation = `${manifestLocation}.files[${index}]`;
    if (!expectExactKeys(fileEntry, RUNNER_ARTIFACT_FILE_KEYS, fileLocation, issues)) continue;
    const normalized = normalizeRunnerRelativePath(fileEntry.path, `${fileLocation}.path`, issues);
    expectSha256(fileEntry.sha256, `${fileLocation}.sha256`, issues);
    if (!Number.isInteger(fileEntry.bytes) || fileEntry.bytes < 0) issues.push(issue('RUNNER_ARTIFACT_BYTES_INVALID', `${fileLocation}.bytes`, 'Artifact byte count must be a non-negative integer.'));
    if (fileEntry.privacyClass !== 'safe_evidence') issues.push(issue('RUNNER_ARTIFACT_PRIVACY_CLASS_INVALID', `${fileLocation}.privacyClass`, 'Runner artifacts must be safe_evidence.'));
    if (!normalized) continue;
    if (files.has(normalized)) {
      issues.push(issue('RUNNER_ARTIFACT_PATH_DUPLICATE', `${fileLocation}.path`, 'Runner artifact paths must be unique.'));
      continue;
    }
    const nestedPath = resolveContained(manifestDir, normalized, `${fileLocation}.path`, issues);
    if (!nestedPath) continue;
    const resolvedIdentity = path.resolve(nestedPath).replace(/\\/gu, '/').toLowerCase();
    if (resolvedFileIdentities.has(resolvedIdentity)) {
      issues.push(issue('RUNNER_ARTIFACT_PHYSICAL_PATH_DUPLICATE', `${fileLocation}.path`, 'Runner manifest entries cannot alias one physical file.'));
      continue;
    }
    resolvedFileIdentities.add(resolvedIdentity);
    const nestedFile = await readAndHash(nestedPath, `${fileLocation}.path`, issues);
    if (!nestedFile) continue;
    if (nestedFile.sha256 !== fileEntry.sha256) issues.push(issue('RUNNER_ARTIFACT_FILE_HASH_MISMATCH', `${fileLocation}.sha256`, `Expected ${nestedFile.sha256}.`));
    if (nestedFile.content.byteLength !== fileEntry.bytes) issues.push(issue('RUNNER_ARTIFACT_FILE_SIZE_MISMATCH', `${fileLocation}.bytes`, `Expected ${nestedFile.content.byteLength}.`));
    if (TEXT_EVIDENCE_EXTENSIONS.has(path.extname(nestedPath).toLowerCase())) {
      const text = nestedFile.content.toString('utf8');
      scanText(text, `${fileLocation}.path`, issues);
      if (path.extname(nestedPath).toLowerCase() === '.json') parseJsonBuffer(nestedFile, `${fileLocation}.path`, 'RUNNER_NESTED_JSON_INVALID', issues);
    }
    files.set(normalized, { ...nestedFile, entry: fileEntry, normalized });
  }
  const resultFile = files.get('result.json');
  if (!resultFile) issues.push(issue('RUNNER_RESULT_NOT_BOUND_BY_ARTIFACT_MANIFEST', `${manifestLocation}.files`, 'Artifact manifest must bind result.json.'));
  else if (!sameResolvedPath(resultFile.path, resultArtifact.path)) issues.push(issue('RUNNER_RESULT_ARTIFACT_PATH_MISMATCH', `${manifestLocation}.files`, 'The evidence runner_result must be the manifest-bound result.json.'));
  return { manifest, files };
}

function validateJourneyResultAgainstProfile({ resultArtifact, runnerManifest, binding, profile, location, issues }) {
  const resultLocation = `${location}.runner_result`;
  const result = parseJsonBuffer(resultArtifact, resultLocation, 'RUNNER_RESULT_JSON_INVALID', issues);
  if (!result) return;
  expectExactKeys(result, JOURNEY_RESULT_KEYS, resultLocation, issues);
  if (result.schemaVersion !== profile.result_schema_id) issues.push(issue('RUNNER_RESULT_SCHEMA_INVALID', `${resultLocation}.schemaVersion`, `Expected ${profile.result_schema_id}.`));
  if (result.journeyTrialId !== binding?.journeyTrialId) issues.push(issue('RUNNER_JOURNEY_TRIAL_MISMATCH', `${resultLocation}.journeyTrialId`, 'Runner result does not bind the evidence journey trial.'));
  if (result.journeyId !== profile.journey_id || result.tier !== profile.tier || result.batch !== profile.batch) issues.push(issue('RUNNER_JOURNEY_PROFILE_MISMATCH', resultLocation, 'Runner result is not the required dev-kernel-core L2/core journey.'));
  if (!Number.isInteger(result.repeatIndex) || result.repeatIndex < 1) issues.push(issue('RUNNER_REPEAT_INDEX_INVALID', `${resultLocation}.repeatIndex`, 'Runner repeatIndex must be a positive integer.'));
  if (!Number.isInteger(result.durationMs) || result.durationMs < 0) issues.push(issue('RUNNER_DURATION_INVALID', `${resultLocation}.durationMs`, 'Runner duration must be a non-negative integer.'));
  if (!isPlainObject(result.sourceState) || result.sourceState.sourceDigest !== binding?.sourceStateDigest) issues.push(issue('RUNNER_SOURCE_STATE_DIGEST_MISMATCH', `${resultLocation}.sourceState.sourceDigest`, 'Runner source state does not bind the evidence source digest.'));
  if (!isPlainObject(result.environmentIdentity)
      || !expectNonEmptyString(result.environmentIdentity.rootId, `${resultLocation}.environmentIdentity.rootId`, issues)
      || JSON.stringify(canonicalize(result.environmentIdentity.processStarts)) !== JSON.stringify(canonicalize(profile.exact_process_starts))) {
    issues.push(issue('RUNNER_PROCESS_STARTS_INVALID', `${resultLocation}.environmentIdentity.processStarts`, 'Runner must report the exact fixed-service Desktop/Zhiyu process-start budget.'));
  }
  if (!expectArray(result.processProblems, `${resultLocation}.processProblems`, issues) || result.processProblems.length !== 0) issues.push(issue('RUNNER_PROCESS_PROBLEMS_NONZERO', `${resultLocation}.processProblems`, 'Accepted journey cannot contain process problems.'));
  validateZeroPrivacy(result.privacy, `${resultLocation}.privacy`, 'RUNNER_RESULT_PRIVACY_INVALID', issues);
  if (result.outcome !== 'passed') issues.push(issue('RUNNER_OUTCOME_NOT_PASSED', `${resultLocation}.outcome`, 'Accepted journey outcome must be passed.'));

  const checkpoints = new Map();
  if (expectArray(result.checkpoints, `${resultLocation}.checkpoints`, issues)) {
    for (const [index, checkpoint] of result.checkpoints.entries()) {
      const checkpointLocation = `${resultLocation}.checkpoints[${index}]`;
      if (!expectExactKeys(checkpoint, ['checkpointId', 'prerequisiteIds', 'startedAt', 'completedAt', 'correlations', 'assertions', 'artifactRefs', 'outcome'], checkpointLocation, issues)) continue;
      if (!expectNonEmptyString(checkpoint.checkpointId, `${checkpointLocation}.checkpointId`, issues)) continue;
      if (checkpoints.has(checkpoint.checkpointId)) issues.push(issue('RUNNER_CHECKPOINT_DUPLICATE', `${checkpointLocation}.checkpointId`, 'Runner checkpoint ids must be unique.'));
      checkpoints.set(checkpoint.checkpointId, checkpoint);
      if (checkpoint.outcome !== 'passed') issues.push(issue('RUNNER_CHECKPOINT_NOT_PASSED', `${checkpointLocation}.outcome`, `${checkpoint.checkpointId} must be passed.`));
      let assertionInvalid = !expectArray(checkpoint.assertions, `${checkpointLocation}.assertions`, issues)
        || checkpoint.assertions.length === 0;
      for (const [assertionIndex, assertion] of (Array.isArray(checkpoint.assertions) ? checkpoint.assertions : []).entries()) {
        const assertionLocation = `${checkpointLocation}.assertions[${assertionIndex}]`;
        if (!expectExactKeys(assertion, ['assertionId', 'outcome'], assertionLocation, issues)
            || !expectNonEmptyString(assertion.assertionId, `${assertionLocation}.assertionId`, issues)
            || assertion.outcome !== 'passed') assertionInvalid = true;
      }
      if (assertionInvalid) {
        issues.push(issue('RUNNER_CHECKPOINT_ASSERTION_NOT_PASSED', `${checkpointLocation}.assertions`, `${checkpoint.checkpointId} has a non-passing assertion.`));
      }
    }
  }
  if (!sameStringSet([...checkpoints.keys()], profile.exact_required_checkpoints)) issues.push(issue('RUNNER_CHECKPOINT_SET_INVALID', `${resultLocation}.checkpoints`, 'Runner result must contain exactly the required dev-kernel-core checkpoints.'));

  const artifacts = new Map();
  const boundManifestPaths = new Set();
  if (expectArray(result.artifacts, `${resultLocation}.artifacts`, issues)) {
    for (const [index, artifact] of result.artifacts.entries()) {
      const artifactLocation = `${resultLocation}.artifacts[${index}]`;
      if (!expectExactKeys(artifact, JOURNEY_ARTIFACT_KEYS, artifactLocation, issues)) continue;
      if (!expectNonEmptyString(artifact.artifactId, `${artifactLocation}.artifactId`, issues)) continue;
      if (artifacts.has(artifact.artifactId)) issues.push(issue('RUNNER_RESULT_ARTIFACT_ID_DUPLICATE', `${artifactLocation}.artifactId`, 'Runner result artifact ids must be unique.'));
      artifacts.set(artifact.artifactId, artifact);
      expectNonEmptyString(artifact.path, `${artifactLocation}.path`, issues);
      expectSha256(artifact.sha256, `${artifactLocation}.sha256`, issues);
      if (!Number.isInteger(artifact.bytes) || artifact.bytes < 0) issues.push(issue('RUNNER_RESULT_ARTIFACT_BYTES_INVALID', `${artifactLocation}.bytes`, 'Artifact byte count must be a non-negative integer.'));
      if (artifact.privacyClass !== 'safe_evidence') issues.push(issue('RUNNER_RESULT_ARTIFACT_PRIVACY_CLASS_INVALID', `${artifactLocation}.privacyClass`, 'Runner result artifacts must be safe_evidence.'));
      const manifestFile = [...(runnerManifest?.files?.values() ?? [])]
        .find((file) => file.normalized !== 'result.json' && runnerArtifactPathMatches(artifact.path, file.normalized));
      if (!manifestFile) issues.push(issue('RUNNER_RESULT_ARTIFACT_NOT_MANIFEST_BOUND', `${artifactLocation}.path`, 'Runner result artifact is not bound by the artifact manifest.'));
      else {
        if (boundManifestPaths.has(manifestFile.normalized)) issues.push(issue('RUNNER_RESULT_ARTIFACT_FILE_REUSED', `${artifactLocation}.path`, 'Distinct runner artifact ids cannot reuse one manifest file.'));
        boundManifestPaths.add(manifestFile.normalized);
        if (manifestFile.sha256 !== artifact.sha256 || manifestFile.content.byteLength !== artifact.bytes) issues.push(issue('RUNNER_RESULT_ARTIFACT_HASH_MISMATCH', artifactLocation, 'Runner result artifact hash/size differs from the manifest-bound file.'));
      }
    }
  }
  for (const artifactId of profile.required_artifact_ids) if (!artifacts.has(artifactId)) issues.push(issue('RUNNER_REQUIRED_ARTIFACT_MISSING', `${resultLocation}.artifacts`, `Missing ${artifactId}.`));
  const screenshotCount = [...artifacts.values()].filter((artifact) => artifact.artifactId.startsWith('real-shell-') && /\.png$/iu.test(artifact.path)).length;
  if (screenshotCount < profile.minimum_shell_screenshot_artifacts) issues.push(issue('RUNNER_SHELL_SCREENSHOTS_INSUFFICIENT', `${resultLocation}.artifacts`, `Expected at least ${profile.minimum_shell_screenshot_artifacts} desktop/narrow shell screenshots.`));
  if (runnerManifest && runnerManifest.files.size !== artifacts.size + 1) issues.push(issue('RUNNER_ARTIFACT_MANIFEST_FILE_SET_MISMATCH', `${location}.runner_artifact_manifest.files`, 'Artifact manifest must bind exactly result.json plus every runner result artifact.'));
  if (runnerManifest && [...runnerManifest.files.keys()].some((file) => file !== 'result.json' && !boundManifestPaths.has(file))) issues.push(issue('RUNNER_ARTIFACT_MANIFEST_FILE_UNCLAIMED', `${location}.runner_artifact_manifest.files`, 'Every manifest evidence file must be claimed by one runner result artifact.'));
  for (const [checkpointId, checkpoint] of checkpoints) {
    if (!expectArray(checkpoint.artifactRefs, `${resultLocation}.checkpoints.${checkpointId}.artifactRefs`, issues)) continue;
    for (const artifactRef of checkpoint.artifactRefs) {
      if (!artifacts.has(artifactRef)) issues.push(issue('RUNNER_CHECKPOINT_ARTIFACT_REF_UNKNOWN', `${resultLocation}.checkpoints.${checkpointId}.artifactRefs`, `${checkpointId} references unknown artifact ${artifactRef}.`));
    }
  }
  if (expectArray(result.leafResults, `${resultLocation}.leafResults`, issues)) {
    for (const [index, leaf] of result.leafResults.entries()) {
      if (leaf?.journeyTrialId !== result.journeyTrialId || leaf?.outcome !== 'passed') issues.push(issue('RUNNER_LEAF_RESULT_INVALID', `${resultLocation}.leafResults[${index}]`, 'Any emitted leaf result must bind this trial and pass.'));
    }
  }
}

function validateExecutionObservation(artifact, binding, location, issues) {
  if (!artifact) {
    issues.push(issue('EXECUTION_OBSERVATION_REQUIRED', `${location}.artifactRefs`, 'Execution-bound evidence needs a hashed execution_observation artifact.'));
    return;
  }
  const observation = parseJsonBuffer(artifact, `${location}.execution_observation`, 'EXECUTION_OBSERVATION_JSON_INVALID', issues);
  if (!observation) return;
  expectExactKeys(observation, EXECUTION_OBSERVATION_KEYS, `${location}.execution_observation`, issues);
  if (observation.schemaId !== EXECUTION_OBSERVATION_SCHEMA_ID) issues.push(issue('EXECUTION_OBSERVATION_SCHEMA_INVALID', `${location}.execution_observation.schemaId`, `Expected ${EXECUTION_OBSERVATION_SCHEMA_ID}.`));
  if (observation.executionSetId !== binding.executionSetId || observation.journeyTrialId !== binding.journeyTrialId || observation.sourceStateDigest !== binding.sourceStateDigest) issues.push(issue('EXECUTION_OBSERVATION_BINDING_MISMATCH', `${location}.execution_observation`, 'Execution observation does not bind the evidence execution tuple.'));
  if (observation.outcome !== 'passed') issues.push(issue('EXECUTION_OBSERVATION_NOT_PASSED', `${location}.execution_observation.outcome`, 'Execution observation outcome must be passed.'));
}

async function loadEvidenceArtifacts(record, evidencePath, evidencePolicy, location, issues) {
  const artifacts = new Map();
  if (!expectArray(record.artifactRefs, `${location}.artifactRefs`, issues)) return artifacts;
  if (record.artifactRefs.length === 0) issues.push(issue('EVIDENCE_ARTIFACT_REF_REQUIRED', `${location}.artifactRefs`, 'Evidence record must bind at least one concrete artifact.'));
  const recordDir = path.dirname(evidencePath);
  for (const [index, artifact] of record.artifactRefs.entries()) {
    const artifactLocation = `${location}.artifactRefs[${index}]`;
    if (!expectExactKeys(artifact, EVIDENCE_ARTIFACT_REF_KEYS, artifactLocation, issues)) continue;
    if (!expectEnum(artifact.role, evidencePolicy.artifact_role_enum, `${artifactLocation}.role`, 'EVIDENCE_ARTIFACT_ROLE_INVALID', issues)) continue;
    if (artifacts.has(artifact.role)) issues.push(issue('DUPLICATE_EVIDENCE_ARTIFACT_ROLE', `${artifactLocation}.role`, 'Evidence artifact roles must be unique within one record.'));
    expectSha256(artifact.sha256, `${artifactLocation}.sha256`, issues);
    if (!validateRelativeRef(artifact.ref, `${artifactLocation}.ref`, issues)) continue;
    const artifactPath = resolveContained(recordDir, artifact.ref, `${artifactLocation}.ref`, issues);
    if (!artifactPath) continue;
    const artifactFile = await readAndHash(artifactPath, `${artifactLocation}.ref`, issues);
    if (!artifactFile) continue;
    if (artifactFile.sha256 !== artifact.sha256) issues.push(issue('EVIDENCE_ARTIFACT_HASH_MISMATCH', `${artifactLocation}.sha256`, `Expected ${artifactFile.sha256}.`));
    if (TEXT_EVIDENCE_EXTENSIONS.has(path.extname(artifactPath).toLowerCase())) {
      const artifactText = artifactFile.content.toString('utf8');
      scanText(artifactText, `${artifactLocation}.ref`, issues);
      const extension = path.extname(artifactPath).toLowerCase();
      if (extension === '.json' || extension === '.yaml' || extension === '.yml') {
        try {
          const parsedArtifact = extension === '.json' ? JSON.parse(artifactText) : parseYaml(artifactText);
          scanSensitiveObject(parsedArtifact, `${artifactLocation}.ref`, issues);
        } catch {
          // Kind-specific validation emits a typed syntax issue where JSON is required.
        }
      }
    }
    artifacts.set(artifact.role, artifactFile);
  }
  return artifacts;
}

async function validateEvidenceRecord(entry, manifestDir, candidateBinding, policy, issues) {
  const location = `manifest.evidence.${entry?.evidenceId ?? '<unknown>'}`;
  if (!expectExactKeys(entry, ['evidenceId', 'kind', 'ref', 'sha256', 'candidateBindingSha256'], location, issues)) return null;
  expectNonEmptyString(entry.evidenceId, `${location}.evidenceId`, issues);
  expectEnum(entry.kind, policy.evidenceKinds, `${location}.kind`, 'EVIDENCE_KIND_INVALID', issues);
  expectSha256(entry.sha256, `${location}.sha256`, issues);
  expectSha256(entry.candidateBindingSha256, `${location}.candidateBindingSha256`, issues);
  if (entry.candidateBindingSha256 !== candidateBinding) issues.push(issue('EVIDENCE_CANDIDATE_BINDING_MISMATCH', `${location}.candidateBindingSha256`, 'Evidence entry does not bind the manifest candidate.'));
  if (!validateRelativeRef(entry.ref, `${location}.ref`, issues)) return { id: entry.evidenceId, claims: [] };
  const evidencePath = resolveContained(manifestDir, entry.ref, `${location}.ref`, issues);
  if (!evidencePath) return { id: entry.evidenceId, claims: [] };
  const loaded = await readAndHash(evidencePath, `${location}.ref`, issues);
  if (!loaded) return { id: entry.evidenceId, claims: [] };
  if (loaded.sha256 !== entry.sha256) issues.push(issue('EVIDENCE_FILE_HASH_MISMATCH', `${location}.sha256`, `Expected ${loaded.sha256}.`));
  let record;
  try {
    record = JSON.parse(loaded.content.toString('utf8'));
  } catch {
    issues.push(issue('EVIDENCE_RECORD_JSON_REQUIRED', `${location}.ref`, 'Candidate-bound evidence records must be JSON.'));
    return { id: entry.evidenceId, claims: [] };
  }
  const recordLocation = `evidence.${entry.evidenceId}`;
  scanManifestObject(record, recordLocation, issues);
  if (!expectExactKeys(record, EVIDENCE_RECORD_KEYS, recordLocation, issues)) {
    return { id: entry.evidenceId, kind: entry.kind, claims: [], executionBinding: null };
  }
  if (record.schemaId !== EVIDENCE_SCHEMA_ID) issues.push(issue('EVIDENCE_RECORD_SCHEMA_INVALID', `${recordLocation}.schemaId`, `Expected ${EVIDENCE_SCHEMA_ID}.`));
  if (record.evidenceId !== entry.evidenceId) issues.push(issue('EVIDENCE_RECORD_ID_MISMATCH', `${recordLocation}.evidenceId`, 'Evidence record id differs from manifest entry.'));
  if (record.candidateBindingSha256 !== candidateBinding) issues.push(issue('EVIDENCE_RECORD_CANDIDATE_MISMATCH', `${recordLocation}.candidateBindingSha256`, 'Evidence record does not bind the manifest candidate.'));
  if (record.evidenceKind !== entry.kind) issues.push(issue('EVIDENCE_RECORD_KIND_MISMATCH', `${recordLocation}.evidenceKind`, 'Evidence record kind differs from manifest entry.'));

  const claims = [];
  const claimKeys = new Set();
  let requiresExecution = false;
  const runnerProfileIds = new Set();
  if (expectArray(record.claims, `${recordLocation}.claims`, issues)) {
    if (record.claims.length === 0) issues.push(issue('EVIDENCE_CLAIM_REQUIRED', `${recordLocation}.claims`, 'Evidence record must carry at least one row-specific claim.'));
    for (const [index, claim] of record.claims.entries()) {
      const claimLocation = `${recordLocation}.claims[${index}]`;
      if (!expectExactKeys(claim, EVIDENCE_CLAIM_KEYS, claimLocation, issues)) continue;
      expectNonEmptyString(claim.rowId, `${claimLocation}.rowId`, issues);
      expectNonEmptyString(claim.claimId, `${claimLocation}.claimId`, issues);
      const claimKey = `${claim.rowId}\u0000${claim.claimId}`;
      if (claimKeys.has(claimKey)) issues.push(issue('DUPLICATE_EVIDENCE_CLAIM', claimLocation, 'Evidence claims must be unique.'));
      claimKeys.add(claimKey);
      const rowPolicy = policy.policies?.[claim.rowId];
      const requiredClaim = rowPolicy?.required_claims.find((candidate) => candidate.claim_id === claim.claimId);
      if (!rowPolicy) issues.push(issue('EVIDENCE_CLAIM_ROW_UNKNOWN', `${claimLocation}.rowId`, `${claim.rowId} is not a required checkpoint row.`));
      else if (!requiredClaim) issues.push(issue('EVIDENCE_CLAIM_UNKNOWN', `${claimLocation}.claimId`, `${claim.claimId} is not required for ${claim.rowId}.`));
      else {
        if (!requiredClaim.allowed_evidence_kinds.includes(record.evidenceKind)) issues.push(issue('EVIDENCE_KIND_NOT_ALLOWED_FOR_CLAIM', `${recordLocation}.evidenceKind`, `${record.evidenceKind} cannot prove ${claim.rowId}/${claim.claimId}.`));
        if (requiredClaim.execution_binding === 'required') requiresExecution = true;
        if (requiredClaim.runner_profile) runnerProfileIds.add(requiredClaim.runner_profile);
      }
      claims.push({ ...claim, policy: requiredClaim });
    }
  }
  if (new Set(claims.map((claim) => claim.rowId)).size === EXPECTED_REQUIRED_ROWS.length) issues.push(issue('GENERIC_ALL_ROWS_EVIDENCE_FORBIDDEN', `${recordLocation}.claims`, 'One evidence record cannot stand in for every required row.'));

  const executionBinding = record.executionBinding === null
    ? null
    : validateExecutionBinding(record.executionBinding, candidateBinding, `${recordLocation}.executionBinding`, issues);
  for (const [index, claim] of claims.entries()) {
    if (claim.policy?.execution_binding === 'required' && !executionBinding) issues.push(issue('CLAIM_EXECUTION_BINDING_REQUIRED', `${recordLocation}.claims[${index}]`, `${claim.rowId}/${claim.claimId} needs execution binding.`));
    if (claim.policy?.execution_binding === 'forbidden' && record.executionBinding !== null) issues.push(issue('CLAIM_EXECUTION_BINDING_FORBIDDEN', `${recordLocation}.claims[${index}]`, `${claim.rowId}/${claim.claimId} is static evidence and cannot inherit a journey binding.`));
  }
  const artifacts = await loadEvidenceArtifacts(record, evidencePath, policy.evidenceRecord, recordLocation, issues);
  if (requiresExecution && executionBinding) validateExecutionObservation(artifacts.get('execution_observation'), executionBinding, recordLocation, issues);
  for (const runnerProfileId of runnerProfileIds) {
    const runnerProfile = policy.runnerProfiles[runnerProfileId];
    const resultArtifact = artifacts.get('runner_result');
    const artifactManifest = artifacts.get('runner_artifact_manifest');
    if (!resultArtifact || !artifactManifest) {
      issues.push(issue('RUNNER_ARTIFACT_PAIR_REQUIRED', `${recordLocation}.artifactRefs`, `${runnerProfileId} requires runner_result and runner_artifact_manifest.`));
      continue;
    }
    const validatedManifest = await validateRunnerArtifactManifest({ artifactFile: artifactManifest, resultArtifact, binding: executionBinding, profile: runnerProfile, location: recordLocation, issues });
    validateJourneyResultAgainstProfile({ resultArtifact, runnerManifest: validatedManifest, binding: executionBinding, profile: runnerProfile, location: recordLocation, issues });
  }
  return { id: entry.evidenceId, kind: record.evidenceKind, claims, executionBinding };
}

async function validateEvidence(evidence, manifestPath, candidateBinding, policy, issues) {
  const location = 'manifest.evidence';
  if (!expectArray(evidence, location, issues)) return new Map();
  if (evidence.length === 0) issues.push(issue('CANDIDATE_EVIDENCE_REQUIRED', location, 'At least one candidate-bound evidence record is required.'));
  const records = new Map();
  const manifestDir = path.dirname(manifestPath);
  for (const entry of evidence) {
    const record = await validateEvidenceRecord(entry, manifestDir, candidateBinding, policy, issues);
    if (!record?.id) continue;
    if (records.has(record.id)) issues.push(issue('DUPLICATE_EVIDENCE_ID', `${location}.${record.id}`, 'Evidence ids must be unique.'));
    records.set(record.id, record);
  }
  return records;
}

function sameExecutionTuple(left, right) {
  return left?.executionSetId === right?.executionSetId
    && left?.journeyTrialId === right?.journeyTrialId
    && left?.sourceStateDigest === right?.sourceStateDigest;
}

function validateRows(rows, evidenceById, policies, issues) {
  const location = 'manifest.acceptanceRows';
  if (!expectArray(rows, location, issues)) return;
  const byId = new Map();
  const referencedEvidence = new Set();
  let sharedExecutionBinding = null;
  for (const [index, row] of rows.entries()) {
    const itemLocation = `${location}[${index}]`;
    if (!expectExactKeys(row, ['rowId', 'result', 'evidenceRefs'], itemLocation, issues)) continue;
    if (expectNonEmptyString(row.rowId, `${itemLocation}.rowId`, issues)) {
      if (byId.has(row.rowId)) issues.push(issue('DUPLICATE_ACCEPTANCE_ROW', `${itemLocation}.rowId`, 'Acceptance row ids must be unique.'));
      byId.set(row.rowId, row);
    }
    if (row.result !== 'pass') issues.push(issue('ACCEPTANCE_ROW_NOT_PASS', `${itemLocation}.result`, 'Every required checkpoint row must be pass.'));
    if (!expectArray(row.evidenceRefs, `${itemLocation}.evidenceRefs`, issues)) continue;
    if (row.evidenceRefs.length === 0) issues.push(issue('ROW_EVIDENCE_REQUIRED', `${itemLocation}.evidenceRefs`, 'Every required row needs candidate-bound evidence refs.'));
    const localRefs = new Set();
    const provenClaims = new Set();
    for (const ref of row.evidenceRefs) {
      if (!expectNonEmptyString(ref, `${itemLocation}.evidenceRefs`, issues)) continue;
      if (localRefs.has(ref)) issues.push(issue('DUPLICATE_ROW_EVIDENCE_REF', `${itemLocation}.evidenceRefs`, 'Row evidence refs must be unique.'));
      localRefs.add(ref);
      referencedEvidence.add(ref);
      const record = evidenceById.get(ref);
      if (!record) {
        issues.push(issue('ROW_EVIDENCE_REF_UNKNOWN', `${itemLocation}.evidenceRefs`, `Unknown evidence id ${ref}.`));
        continue;
      }
      const rowClaims = record.claims.filter((claim) => claim.rowId === row.rowId && claim.policy);
      if (rowClaims.length === 0) issues.push(issue('ROW_EVIDENCE_HAS_NO_ROW_CLAIM', `${itemLocation}.evidenceRefs`, `${ref} carries no admitted claim for ${row.rowId}.`));
      for (const claim of rowClaims) {
        provenClaims.add(claim.claimId);
        if (claim.policy.execution_binding === 'required' && record.executionBinding) {
          if (!sharedExecutionBinding) sharedExecutionBinding = record.executionBinding;
          else if (!sameExecutionTuple(sharedExecutionBinding, record.executionBinding)) issues.push(issue('EXECUTION_BINDING_MISMATCH', `${itemLocation}.evidenceRefs`, 'All execution-class row claims must share one executionSetId/journeyTrialId/sourceStateDigest tuple.'));
        }
      }
    }
    for (const requiredClaim of policies?.[row.rowId]?.required_claims ?? []) {
      if (!provenClaims.has(requiredClaim.claim_id)) issues.push(issue('ROW_REQUIRED_CLAIM_UNPROVEN', `${itemLocation}.evidenceRefs`, `${row.rowId} lacks ${requiredClaim.claim_id}.`));
    }
  }
  for (const rowId of EXPECTED_REQUIRED_ROWS) {
    if (!byId.has(rowId)) issues.push(issue('REQUIRED_ACCEPTANCE_ROW_MISSING', location, `Missing required row ${rowId}.`));
  }
  for (const rowId of byId.keys()) {
    if (!EXPECTED_REQUIRED_ROWS.includes(rowId)) issues.push(issue('EXTRA_ACCEPTANCE_ROW_FOR_CHECKPOINT', `${location}.${rowId}`, `${rowId} is not required by dev_kernel_checkpoint.`));
  }
  for (const [evidenceId, record] of evidenceById) {
    if (!referencedEvidence.has(evidenceId)) issues.push(issue('UNREFERENCED_EVIDENCE_RECORD', `${location}.${evidenceId}`, 'Every manifest evidence record must support at least one required row.'));
    for (const claim of record.claims) {
      const row = byId.get(claim.rowId);
      if (row && !row.evidenceRefs.includes(evidenceId)) issues.push(issue('EVIDENCE_CLAIM_NOT_REFERENCED_BY_ROW', `${location}.${claim.rowId}`, `${claim.rowId} does not reference claiming evidence ${evidenceId}.`));
    }
  }
  if (!sharedExecutionBinding) issues.push(issue('CHECKPOINT_EXECUTION_BINDING_REQUIRED', location, 'The checkpoint requires one shared execution evidence tuple.'));
}

export async function loadAcceptanceSchema() {
  return parseYaml(await fs.readFile(schemaPath, 'utf8'));
}

export async function loadManifest(manifestPath) {
  return parseYaml(await fs.readFile(manifestPath, 'utf8'));
}

function isSyntheticContractFixture(manifest, manifestPath) {
  const fixtureRoot = path.join(repoRoot, 'scripts', 'testdata', 'dev-kernel-checkpoint-acceptance');
  const resolvedManifest = path.resolve(manifestPath);
  const underFixtureRoot = resolvedManifest === fixtureRoot || resolvedManifest.startsWith(`${fixtureRoot}${path.sep}`);
  const syntheticCandidate = typeof manifest?.candidate?.candidateId === 'string'
    && manifest.candidate.candidateId.startsWith('synthetic-');
  const syntheticEvidence = Array.isArray(manifest?.evidence)
    && manifest.evidence.some((entry) => String(entry?.evidenceId ?? '').startsWith('synthetic-')
      || String(entry?.ref ?? '').startsWith('synthetic-'));
  return underFixtureRoot || syntheticCandidate || syntheticEvidence;
}

export async function validateDevKernelCheckpointManifest(manifest, manifestPath, schema = null, options = {}) {
  const issues = [];
  const resolvedSchema = schema ?? await loadAcceptanceSchema();
  const contract = validateSchema(resolvedSchema, issues);
  if (!isPlainObject(manifest)) {
    issues.push(issue('MANIFEST_OBJECT_REQUIRED', 'manifest', 'Manifest must be a YAML/JSON object.'));
    return issues;
  }
  if (options.allowSyntheticFixture !== true && isSyntheticContractFixture(manifest, manifestPath)) {
    issues.push(issue('SYNTHETIC_FIXTURE_NOT_ADMISSIBLE', 'manifest', 'Checker fixtures can validate contract behavior but can never serve as checkpoint evidence.'));
  }
  scanManifestObject(manifest, 'manifest', issues);
  expectExactKeys(manifest, TOP_LEVEL_KEYS, 'manifest', issues);
  if (manifest.schemaId !== contract?.id) issues.push(issue('MANIFEST_SCHEMA_ID_INVALID', 'manifest.schemaId', `Expected ${contract?.id ?? 'the static close contract id'}.`));
  if (manifest.manifestVersion !== 1) issues.push(issue('MANIFEST_VERSION_INVALID', 'manifest.manifestVersion', 'Expected manifestVersion=1.'));
  if (manifest.closeLevel !== REQUIRED_CLOSE_LEVEL) issues.push(issue('CLOSE_LEVEL_INVALID', 'manifest.closeLevel', `Expected ${REQUIRED_CLOSE_LEVEL}.`));
  if (manifest.releasePosture !== 'non_release') issues.push(issue('RELEASE_POSTURE_INVALID', 'manifest.releasePosture', 'Dev kernel checkpoint must be non_release.'));
  if (manifest.productClosePromotion !== 'non_promotable_to_product_close') {
    issues.push(issue('PRODUCT_CLOSE_PROMOTION_INVALID', 'manifest.productClosePromotion', 'Checkpoint cannot promote to product close.'));
  }
  validateCandidate(manifest.candidate, issues);
  if (options.verifyLiveCandidate === true) {
    await validateLiveDevKernelCandidate(manifest, issues);
  }
  validateNotApplicableIdentity(manifest.packageIdentity, 'manifest.packageIdentity', /(?:dev-only|0P|immutable package)/iu, issues);
  validateNotApplicableIdentity(manifest.signingIdentity, 'manifest.signingIdentity', /(?:dev-only|0P|package signing)/iu, issues);
  validateDevelopmentServiceSignature(manifest.developmentServiceSignature, manifest.candidate?.runtime, issues);
  const computedBinding = computeCandidateBindingSha256(manifest);
  if (!expectSha256(manifest.candidateBindingSha256, 'manifest.candidateBindingSha256', issues)
      || manifest.candidateBindingSha256 !== computedBinding) {
    issues.push(issue('CANDIDATE_BINDING_HASH_MISMATCH', 'manifest.candidateBindingSha256', `Expected ${computedBinding}.`));
  }
  const evidencePolicy = contract?.validatedEvidencePolicy ?? {
    evidenceKinds: [],
    policies: {},
    runnerProfiles: {},
    evidenceRecord: { artifact_role_enum: [] },
  };
  evidencePolicy.evidenceRecord = contract?.dev_kernel_checkpoint?.evidence_record ?? evidencePolicy.evidenceRecord;
  const evidenceById = await validateEvidence(manifest.evidence, manifestPath, manifest.candidateBindingSha256, evidencePolicy, issues);
  validateRows(manifest.acceptanceRows, evidenceById, evidencePolicy.policies, issues);
  return issues;
}

function printIssues(issues) {
  process.stderr.write('dev kernel checkpoint acceptance failed:\n');
  for (const item of issues) process.stderr.write(`- ${item.code}: ${item.reason} (${item.location})\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const fixtureMode = args[0] === '--fixture-mode';
  const manifestArgs = fixtureMode ? args.slice(1) : args;
  if (manifestArgs.length !== 2 || manifestArgs[0] !== '--manifest' || !manifestArgs[1]) {
    process.stderr.write('CLI_USAGE_INVALID: usage: check-dev-kernel-checkpoint-acceptance.mjs [--fixture-mode] --manifest <candidate-manifest.yaml>\n');
    process.exitCode = 1;
    return;
  }
  const manifestPath = path.resolve(process.cwd(), manifestArgs[1]);
  let manifest;
  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    process.stderr.write(`MANIFEST_UNREADABLE: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const issues = await validateDevKernelCheckpointManifest(manifest, manifestPath, null, {
    allowSyntheticFixture: fixtureMode,
    verifyLiveCandidate: !fixtureMode,
  });
  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(fixtureMode
    ? `dev kernel checkpoint acceptance fixture: OK (${EXPECTED_REQUIRED_ROWS.length} required rows, non-admissible candidate ${manifest.candidateBindingSha256})\n`
    : `dev kernel checkpoint acceptance: OK (${EXPECTED_REQUIRED_ROWS.length} required rows, candidate ${manifest.candidateBindingSha256})\n`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(scriptPath)) {
  main().catch((error) => {
    process.stderr.write(`dev kernel checkpoint acceptance failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
