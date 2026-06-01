// prepared-storybook-package: the ordinary-user fast path for Play. If a package
// is valid, Play must not require source ingestion, Studio setup, or truth-package
// editing before start/continue. The minimum contract (Decisions 8 & 11) is
// enforced fail-closed: invalid manifest, incompatible version, missing start
// entry, missing required asset, redaction failure, stale projection, and invalid
// validator result are all explicit failures.

import { mintId } from './ids.js';
import { type Result, ok, fail, type ValidationFinding, type ValidationReport, validationReport } from './failure.js';
import { type StorybookTruthPackage, validateTruthPackage } from './truth.js';
import { type PublicCastMember, buildPlayProjection } from './projection.js';
import { isAssetUsable } from './assets.js';
import { type PlayableChapter, findNode } from './run.js';
import { validateDefaultProgression } from './choices.js';

export const PREPARED_PACKAGE_SCHEMA_VERSION = 1;
export const STORYBOOK_APP_VERSION = '0.1.0';

export type AppCompatRange = { min: string; max: string };

export type PackageManifest = {
  packageId: string;
  schemaVersion: number;
  packageVersion: string;
  appCompatRange: AppCompatRange;
  createdAt: string;
  updatedAt: string;
  producer: string;
};

export type AssetManifestEntry = {
  ref: string;
  kind: string;
  requiredness: 'required' | 'optional';
  state: string;
  present: boolean;
};

export type RedactionProof = {
  privateFactsRedacted: number;
  spoilerSurfacesRedacted: number;
  creatorOnlyRouteInternalsRedacted: number;
  leaks: string[];
};

export type PreparedValidatorResult = {
  validatorProfile: string;
  playValid: boolean;
  findings: ValidationFinding[];
};

export type PreparedStorybookPackage = {
  manifest: PackageManifest;
  publicSummary: string;
  contentBoundaries: string[];
  publicCast: PublicCastMember[];
  playerEntryPosture: 'low-configuration';
  playProjectionRef: string;
  truthPackageVersion: number;
  startSemantics: { chapterId: string; nodeId: string };
  continueSemantics: { resumable: boolean };
  chapterEntryRefs: string[];
  /** Baked, self-contained Play projection of the chapter graph. A valid package
   *  plays without the truth package present; this is a cached projection, not a
   *  second source of truth. */
  playableChapters: PlayableChapter[];
  stateMatrix: { variables: Record<string, number>; flags: Record<string, boolean> };
  branchSnapshotPolicy: 'app-internal';
  assetManifest: AssetManifestEntry[];
  redactionPolicy: string;
  redactionProof: RedactionProof;
  validatorResult: PreparedValidatorResult;
};

function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a: string, b: string): number {
  const [a0, a1, a2] = parseSemver(a);
  const [b0, b1, b2] = parseSemver(b);
  return a0 - b0 || a1 - b1 || a2 - b2;
}

export function isAppVersionCompatible(appVersion: string, range: AppCompatRange): boolean {
  return compareSemver(appVersion, range.min) >= 0 && compareSemver(appVersion, range.max) < 0;
}

/** Build redaction proof by confirming no private agent facts reached the public cast. */
function buildRedactionProof(pkg: StorybookTruthPackage, publicCast: PublicCastMember[]): RedactionProof {
  const publicFactSet = new Set(publicCast.flatMap((c) => c.publicFacts.map((f) => f.trim().toLowerCase())));
  const leaks: string[] = [];
  let redacted = 0;
  for (const agent of pkg.agentCast?.agents ?? []) {
    for (const priv of agent.privateFacts) {
      redacted += 1;
      if (publicFactSet.has(priv.trim().toLowerCase())) {
        leaks.push(`${agent.name}: ${priv}`);
      }
    }
  }
  return { privateFactsRedacted: redacted, spoilerSurfacesRedacted: 0, creatorOnlyRouteInternalsRedacted: 0, leaks };
}

/**
 * Build a Play-ready prepared package from an app-owned truth package. Fails closed
 * if the package is not yet Play-valid (missing start entry, missing required
 * asset, redaction leak, or failing truth validation).
 */
export function buildPreparedPackage(input: { pkg: StorybookTruthPackage; producer: string; now: string }): Result<PreparedStorybookPackage> {
  const { pkg, producer, now } = input;

  const truthValidation = validateTruthPackage(pkg);
  const playProjection = buildPlayProjection(pkg);
  const { startChapterId, startNodeId } = playProjection.payload;

  if (!startChapterId || !startNodeId) {
    return fail('prepared_package_missing_start_entry', 'Truth package has no resolvable start chapter/node for Play.');
  }

  for (const asset of pkg.assets) {
    if (asset.requiredness === 'required' && !isAssetUsable(asset)) {
      return fail('prepared_package_missing_required_asset', `Required asset "${asset.description || asset.id}" is in state "${asset.state}".`, [`asset:${asset.id}`]);
    }
  }

  const redactionProof = buildRedactionProof(pkg, playProjection.payload.publicCast);
  if (redactionProof.leaks.length > 0) {
    return fail('prepared_package_redaction_failure', `Private facts leaked into the public cast: ${redactionProof.leaks.join('; ')}`);
  }

  const assetManifest: AssetManifestEntry[] = pkg.assets.map((asset) => ({
    ref: asset.ref,
    kind: asset.kind,
    requiredness: asset.requiredness,
    state: asset.state,
    present: isAssetUsable(asset),
  }));

  const validatorResult: PreparedValidatorResult = {
    validatorProfile: 'play-valid-v1',
    playValid: truthValidation.valid,
    findings: truthValidation.findings,
  };

  if (!validatorResult.playValid) {
    return fail('prepared_package_invalid_validator_result', 'Truth package failed Play-valid validation; cannot prepare a package.', truthValidation.findings.map((f) => f.message));
  }

  const prepared: PreparedStorybookPackage = {
    manifest: {
      packageId: mintId('pkg'),
      schemaVersion: PREPARED_PACKAGE_SCHEMA_VERSION,
      packageVersion: '1.0.0',
      appCompatRange: { min: '0.1.0', max: '1.0.0' },
      createdAt: now,
      updatedAt: now,
      producer,
    },
    publicSummary: playProjection.payload.storySummary,
    contentBoundaries: playProjection.payload.contentBoundaries,
    publicCast: playProjection.payload.publicCast,
    playerEntryPosture: 'low-configuration',
    playProjectionRef: `playproj:${pkg.id}:v${pkg.version}`,
    truthPackageVersion: pkg.version,
    startSemantics: { chapterId: startChapterId, nodeId: startNodeId },
    continueSemantics: { resumable: true },
    chapterEntryRefs: pkg.chapters.map((c) => c.ref),
    playableChapters: pkg.chapters,
    stateMatrix: { variables: playProjection.payload.initialVariables, flags: playProjection.payload.initialFlags },
    branchSnapshotPolicy: 'app-internal',
    assetManifest,
    redactionPolicy: 'private-facts-spoilers-creator-route-internals-source-only',
    redactionProof,
    validatorResult,
  };
  return ok(prepared);
}

/**
 * Fail-closed Play-load validation of a prepared package (used before start/continue
 * and on import). `options.currentTruthPackageVersion` enables stale-projection
 * detection against a locally held truth package, if any.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed Play-load validation of an arbitrary value (e.g. user-pasted JSON).
 * It NEVER throws: a malformed shape (missing manifest, wrong types, missing
 * arrays) is reported as typed findings, not an exception. This is the import
 * fast-path guard — a `{}` import yields findings, not a crash.
 */
export function validatePreparedPackage(
  prepared: unknown,
  options?: { currentAppVersion?: string; currentTruthPackageVersion?: number },
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const appVersion = options?.currentAppVersion ?? STORYBOOK_APP_VERSION;

  if (!isRecord(prepared)) {
    return validationReport([{ code: 'prepared_package_invalid_manifest', message: 'Prepared package must be a non-null object.', pointers: ['(root)'] }]);
  }

  // --- manifest ---
  const manifest = prepared.manifest;
  if (!isRecord(manifest)) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package has no manifest object.', pointers: ['manifest'] });
  } else {
    if (typeof manifest.packageId !== 'string' || !manifest.packageId.trim()) {
      findings.push({ code: 'prepared_package_invalid_manifest', message: 'Manifest packageId is missing or empty.', pointers: ['manifest.packageId'] });
    }
    if (manifest.schemaVersion !== PREPARED_PACKAGE_SCHEMA_VERSION) {
      findings.push({ code: 'prepared_package_incompatible_version', message: `Manifest schemaVersion ${String(manifest.schemaVersion)} != supported ${PREPARED_PACKAGE_SCHEMA_VERSION}.`, pointers: ['manifest.schemaVersion'] });
    }
    const range = manifest.appCompatRange;
    if (!isRecord(range) || typeof range.min !== 'string' || typeof range.max !== 'string') {
      findings.push({ code: 'prepared_package_invalid_manifest', message: 'Manifest appCompatRange is missing or malformed.', pointers: ['manifest.appCompatRange'] });
    } else if (!isAppVersionCompatible(appVersion, range as AppCompatRange)) {
      findings.push({ code: 'prepared_package_incompatible_version', message: `App ${appVersion} is outside the package compatibility range ${range.min}..${range.max}.`, pointers: ['manifest.appCompatRange'] });
    }
  }

  // --- baked playable chapters (validated before start-entry so we can resolve it) ---
  const playableChapters = Array.isArray(prepared.playableChapters) ? (prepared.playableChapters as PlayableChapter[]) : null;
  if (!playableChapters) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package playableChapters must be an array.', pointers: ['playableChapters'] });
  }

  // --- start semantics ---
  const start = prepared.startSemantics;
  if (!isRecord(start) || typeof start.chapterId !== 'string' || typeof start.nodeId !== 'string' || !start.chapterId || !start.nodeId) {
    findings.push({ code: 'prepared_package_missing_start_entry', message: 'Prepared package has no start chapter/node.', pointers: ['startSemantics'] });
  } else if (playableChapters) {
    const startChapter = playableChapters.find((c) => c && c.id === start.chapterId);
    if (!startChapter) {
      findings.push({ code: 'prepared_package_missing_start_entry', message: `Start chapter "${start.chapterId}" is not in the baked playable chapters.`, pointers: ['startSemantics.chapterId'] });
    } else if (!findNode(startChapter, String(start.nodeId))) {
      findings.push({ code: 'prepared_package_missing_start_entry', message: `Start node "${start.nodeId}" is not in chapter "${startChapter.id}".`, pointers: ['startSemantics.nodeId'] });
    }
  }

  // The generated-choices default path must hold for every baked chapter.
  if (playableChapters) {
    for (const chapter of playableChapters) {
      if (isRecord(chapter) && Array.isArray((chapter as PlayableChapter).nodes)) {
        findings.push(...validateDefaultProgression(chapter as PlayableChapter));
      } else {
        findings.push({ code: 'prepared_package_invalid_manifest', message: 'A baked chapter is malformed (missing nodes array).', pointers: ['playableChapters'] });
      }
    }
  }

  if (typeof prepared.playProjectionRef !== 'string' || !prepared.playProjectionRef.trim()) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package has no play projection ref.', pointers: ['playProjectionRef'] });
  }

  // --- asset manifest ---
  if (!Array.isArray(prepared.assetManifest)) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package assetManifest must be an array.', pointers: ['assetManifest'] });
  } else {
    for (const entry of prepared.assetManifest as AssetManifestEntry[]) {
      if (isRecord(entry) && entry.requiredness === 'required' && !entry.present) {
        findings.push({ code: 'prepared_package_missing_required_asset', message: `Required asset ${String(entry.ref)} is not present (state ${String(entry.state)}).`, pointers: [`asset:${String(entry.ref)}`] });
      }
    }
  }

  // --- redaction proof ---
  const redaction = prepared.redactionProof;
  if (!isRecord(redaction) || !Array.isArray(redaction.leaks)) {
    findings.push({ code: 'prepared_package_redaction_failure', message: 'Prepared package has no valid redaction proof.', pointers: ['redactionProof'] });
  } else if (redaction.leaks.length > 0) {
    findings.push({ code: 'prepared_package_redaction_failure', message: `Redaction proof reports leaks: ${redaction.leaks.join('; ')}`, pointers: ['redactionProof'] });
  }

  // --- validator result ---
  const validatorResult = prepared.validatorResult;
  if (!isRecord(validatorResult) || validatorResult.playValid !== true) {
    findings.push({ code: 'prepared_package_invalid_validator_result', message: 'Prepared package validator result is missing or not Play-valid.', pointers: ['validatorResult'] });
  }

  // --- player-facing minimum contract (so a Play-valid package is safe to render) ---
  if (typeof prepared.publicSummary !== 'string') {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package publicSummary must be a string.', pointers: ['publicSummary'] });
  }
  if (!Array.isArray(prepared.contentBoundaries)) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package contentBoundaries must be an array.', pointers: ['contentBoundaries'] });
  }
  if (!Array.isArray(prepared.publicCast)) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package publicCast must be an array.', pointers: ['publicCast'] });
  }
  const stateMatrix = prepared.stateMatrix;
  if (!isRecord(stateMatrix) || !isRecord(stateMatrix.variables) || !isRecord(stateMatrix.flags)) {
    findings.push({ code: 'prepared_package_invalid_manifest', message: 'Prepared package stateMatrix must include variables and flags objects.', pointers: ['stateMatrix'] });
  }

  // --- staleness against a locally held truth package version, if provided ---
  if (options?.currentTruthPackageVersion !== undefined && options.currentTruthPackageVersion !== prepared.truthPackageVersion) {
    findings.push({ code: 'prepared_package_stale_projection', message: `Prepared package was built from truth version ${String(prepared.truthPackageVersion)}, but the local truth package is at ${options.currentTruthPackageVersion}.`, pointers: ['truthPackageVersion'] });
  }

  return validationReport(findings);
}
