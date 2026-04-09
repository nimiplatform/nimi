import type { CanonicalPublishableWorldPackage } from '../../../../../../../packages/nimi-forge/src/contracts/index.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

export type ForgePublishWorldPackageInput = {
  mode?: 'upsert-sync' | 'reset-init';
  package: CanonicalPublishableWorldPackage;
  governance: {
    officialOwnerId: string;
    editorialOperatorId: string;
    reviewerId: string;
    publisherId: string;
    publishActorId: string;
    sourceProvenance: 'forge-text-source' | 'forge-file-source' | 'release-rollback';
    reviewVerdict: 'approved' | 'changes-requested' | 'rejected';
    releaseTag?: string;
    releaseSummary?: string;
    changeSummary?: string;
  };
  operations?: {
    batchRunId?: string;
    batchItemId?: string;
    qualityGate?: {
      status: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED';
      score?: number | null;
      findingCount?: number | null;
      findings?: string[];
    };
    titleLineageReason?: string;
  };
};

export type ForgeWorldReleaseDiffSummary = {
  previousReleaseId?: string | null;
  rollbackTargetReleaseId?: string | null;
  worldRulesChanged: boolean;
  worldRuleDelta: number;
  agentRuleSnapshotsChanged: boolean;
  agentRuleSnapshotDelta: number;
  worldviewChanged: boolean;
  lorebookChanged: boolean;
  summaryText?: string | null;
};

export type ForgeWorldRelease = {
  id: string;
  worldId: string;
  version: number;
  tag?: string | null;
  description?: string | null;
  packageVersion?: string | null;
  releaseType: 'SNAPSHOT' | 'MILESTONE' | 'PUBLISH' | 'ROLLBACK';
  status: 'DRAFT' | 'FROZEN' | 'PUBLISHED' | 'SUPERSEDED';
  ruleCount: number;
  ruleChecksum: string;
  worldviewChecksum?: string | null;
  lorebookChecksum?: string | null;
  sourceProvenance?: 'forge-text-source' | 'forge-file-source' | 'release-rollback' | null;
  reviewVerdict?: 'approved' | 'changes-requested' | 'rejected' | null;
  officialOwnerId?: string | null;
  editorialOperatorId?: string | null;
  reviewerId?: string | null;
  publisherId?: string | null;
  publishActorId?: string | null;
  supersedesReleaseId?: string | null;
  rollbackFromReleaseId?: string | null;
  diffSummary?: ForgeWorldReleaseDiffSummary | null;
  frozenAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  createdBy: string;
};

export type ForgeOfficialFactoryQualityGateSummary = {
  status: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED';
  score?: number | null;
  findingCount?: number | null;
  findings?: string[];
};

export type ForgeOfficialFactoryBatchItem = {
  id: string;
  runId: string;
  worldId?: string | null;
  slug: string;
  sourceTitle: string;
  canonicalTitle: string;
  titleLineageKey: string;
  sourceMode: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  packageVersion?: string | null;
  releaseId?: string | null;
  releaseVersion?: number | null;
  qualityGateStatus?: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED' | null;
  qualityGateSummary?: ForgeOfficialFactoryQualityGateSummary | null;
  retryCount: number;
  lastError?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ForgeOfficialFactoryBatchRun = {
  id: string;
  name: string;
  requestKey?: string | null;
  requestedBy: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
  pipelineStages: string[];
  retryLimit: number;
  retryCount: number;
  batchItemCount: number;
  successCount: number;
  failureCount: number;
  qualityGateStatus?: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED' | null;
  qualityGateSummary?: ForgeOfficialFactoryQualityGateSummary | null;
  lastError?: string | null;
  lastReleaseId?: string | null;
  executionNotes?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ForgeOfficialFactoryBatchItem[];
};

export type ForgeCreateOfficialFactoryBatchRunInput = {
  name: string;
  requestKey?: string;
  pipelineStages: string[];
  retryLimit?: number;
  executionNotes?: string;
  items: Array<{
    slug: string;
    sourceTitle: string;
    canonicalTitle: string;
    sourceMode: string;
    worldId?: string;
    qualityGate?: ForgeOfficialFactoryQualityGateSummary;
  }>;
};

export type ForgeReportOfficialFactoryBatchItemFailureInput = {
  reason?: string;
  qualityGate?: ForgeOfficialFactoryQualityGateSummary;
};

export type ForgeOfficialWorldTitleLineage = {
  id: string;
  worldId?: string | null;
  slug: string;
  sourceTitle: string;
  canonicalTitle: string;
  titleLineageKey: string;
  packageVersion?: string | null;
  releaseId?: string | null;
  runId?: string | null;
  itemId?: string | null;
  recordedBy: string;
  reason?: string | null;
  createdAt: string;
};

export type ForgePublishWorldPackageResult = {
  slug: string;
  worldId: string;
  worldName: string;
  packageVersion: string;
  mode: 'upsert-sync' | 'reset-init';
  actionCount: number;
  publishedBy: string;
  release: ForgeWorldRelease;
};

export type ForgeRollbackWorldReleaseInput = {
  governance: ForgePublishWorldPackageInput['governance'];
};

export type ForgeRollbackWorldReleaseResult = {
  worldId: string;
  rollbackTargetReleaseId: string;
  release: ForgeWorldRelease;
};

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized ? normalized : undefined;
}

function optionalStringArray(value: unknown, code: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(code);
  }
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0);
}

function requireNumber(value: unknown, code: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  code: string,
): Values[number] {
  const normalized = requireString(value, code);
  if (!allowed.includes(normalized)) {
    throw new Error(code);
  }
  return normalized as Values[number];
}

function normalizeWorldRelease(value: unknown, codePrefix: string): ForgeWorldRelease {
  const releaseRecord = requireRecord(value, `${codePrefix}_INVALID`);
  const diffSummaryValue = releaseRecord.diffSummary;
  const diffSummaryRecord = diffSummaryValue == null
    ? null
    : requireRecord(diffSummaryValue, `${codePrefix}_DIFF_REQUIRED`);
  return {
    id: requireString(releaseRecord.id, `${codePrefix}_ID_REQUIRED`),
    worldId: requireString(releaseRecord.worldId, `${codePrefix}_WORLD_ID_REQUIRED`),
    version: requireNumber(releaseRecord.version, `${codePrefix}_VERSION_REQUIRED`),
    tag: releaseRecord.tag == null ? null : optionalString(releaseRecord.tag) ?? null,
    description: releaseRecord.description == null ? null : optionalString(releaseRecord.description) ?? null,
    packageVersion: releaseRecord.packageVersion == null ? null : optionalString(releaseRecord.packageVersion) ?? null,
    releaseType: requireEnum(
      releaseRecord.releaseType,
      ['SNAPSHOT', 'MILESTONE', 'PUBLISH', 'ROLLBACK'] as const,
      `${codePrefix}_TYPE_REQUIRED`,
    ),
    status: requireEnum(
      releaseRecord.status,
      ['DRAFT', 'FROZEN', 'PUBLISHED', 'SUPERSEDED'] as const,
      `${codePrefix}_STATUS_REQUIRED`,
    ),
    ruleCount: requireNumber(releaseRecord.ruleCount, `${codePrefix}_RULE_COUNT_REQUIRED`),
    ruleChecksum: requireString(releaseRecord.ruleChecksum, `${codePrefix}_RULE_CHECKSUM_REQUIRED`),
    worldviewChecksum: releaseRecord.worldviewChecksum == null ? null : optionalString(releaseRecord.worldviewChecksum) ?? null,
    lorebookChecksum: releaseRecord.lorebookChecksum == null ? null : optionalString(releaseRecord.lorebookChecksum) ?? null,
    sourceProvenance: releaseRecord.sourceProvenance == null
      ? null
      : requireEnum(
        releaseRecord.sourceProvenance,
        ['forge-text-source', 'forge-file-source', 'release-rollback'] as const,
        `${codePrefix}_SOURCE_PROVENANCE_REQUIRED`,
      ),
    reviewVerdict: releaseRecord.reviewVerdict == null
      ? null
      : requireEnum(
        releaseRecord.reviewVerdict,
        ['approved', 'changes-requested', 'rejected'] as const,
        `${codePrefix}_VERDICT_REQUIRED`,
      ),
    officialOwnerId: releaseRecord.officialOwnerId == null ? null : optionalString(releaseRecord.officialOwnerId) ?? null,
    editorialOperatorId: releaseRecord.editorialOperatorId == null ? null : optionalString(releaseRecord.editorialOperatorId) ?? null,
    reviewerId: releaseRecord.reviewerId == null ? null : optionalString(releaseRecord.reviewerId) ?? null,
    publisherId: releaseRecord.publisherId == null ? null : optionalString(releaseRecord.publisherId) ?? null,
    publishActorId: releaseRecord.publishActorId == null ? null : optionalString(releaseRecord.publishActorId) ?? null,
    supersedesReleaseId: releaseRecord.supersedesReleaseId == null ? null : optionalString(releaseRecord.supersedesReleaseId) ?? null,
    rollbackFromReleaseId: releaseRecord.rollbackFromReleaseId == null ? null : optionalString(releaseRecord.rollbackFromReleaseId) ?? null,
    diffSummary: diffSummaryRecord == null
      ? null
      : {
        previousReleaseId: diffSummaryRecord.previousReleaseId == null ? null : optionalString(diffSummaryRecord.previousReleaseId) ?? null,
        rollbackTargetReleaseId: diffSummaryRecord.rollbackTargetReleaseId == null ? null : optionalString(diffSummaryRecord.rollbackTargetReleaseId) ?? null,
        worldRulesChanged: Boolean(diffSummaryRecord.worldRulesChanged),
        worldRuleDelta: requireNumber(diffSummaryRecord.worldRuleDelta, `${codePrefix}_DIFF_WORLD_RULE_DELTA_REQUIRED`),
        agentRuleSnapshotsChanged: Boolean(diffSummaryRecord.agentRuleSnapshotsChanged),
        agentRuleSnapshotDelta: requireNumber(diffSummaryRecord.agentRuleSnapshotDelta, `${codePrefix}_DIFF_AGENT_DELTA_REQUIRED`),
        worldviewChanged: Boolean(diffSummaryRecord.worldviewChanged),
        lorebookChanged: Boolean(diffSummaryRecord.lorebookChanged),
        summaryText: diffSummaryRecord.summaryText == null ? null : optionalString(diffSummaryRecord.summaryText) ?? null,
      },
    frozenAt: releaseRecord.frozenAt == null ? null : optionalString(releaseRecord.frozenAt) ?? null,
    publishedAt: releaseRecord.publishedAt == null ? null : optionalString(releaseRecord.publishedAt) ?? null,
    createdAt: requireString(releaseRecord.createdAt, `${codePrefix}_CREATED_AT_REQUIRED`),
    createdBy: requireString(releaseRecord.createdBy, `${codePrefix}_CREATED_BY_REQUIRED`),
  };
}

function normalizeQualityGateSummary(value: unknown, codePrefix: string): ForgeOfficialFactoryQualityGateSummary {
  const record = requireRecord(value, `${codePrefix}_INVALID`);
  const findings = record.findings;
  return {
    status: requireEnum(record.status, ['PASS', 'WARN', 'FAIL', 'BYPASSED'] as const, `${codePrefix}_STATUS_REQUIRED`),
    score: record.score == null ? null : requireNumber(record.score, `${codePrefix}_SCORE_REQUIRED`),
    findingCount: record.findingCount == null ? null : requireNumber(record.findingCount, `${codePrefix}_FINDING_COUNT_REQUIRED`),
    findings: findings == null ? undefined : optionalStringArray(findings, `${codePrefix}_FINDINGS_REQUIRED`),
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('FORGE_PACKAGE_PUBLISH_RESPONSE_INVALID');
  }
}

function normalizeOfficialFactoryBatchItem(
  value: unknown,
  codePrefix: string,
): ForgeOfficialFactoryBatchItem {
  const record = requireRecord(value, `${codePrefix}_INVALID`);
  return {
    id: requireString(record.id, `${codePrefix}_ID_REQUIRED`),
    runId: requireString(record.runId, `${codePrefix}_RUN_ID_REQUIRED`),
    worldId: record.worldId == null ? null : optionalString(record.worldId) ?? null,
    slug: requireString(record.slug, `${codePrefix}_SLUG_REQUIRED`),
    sourceTitle: requireString(record.sourceTitle, `${codePrefix}_SOURCE_TITLE_REQUIRED`),
    canonicalTitle: requireString(record.canonicalTitle, `${codePrefix}_CANONICAL_TITLE_REQUIRED`),
    titleLineageKey: requireString(record.titleLineageKey, `${codePrefix}_TITLE_LINEAGE_KEY_REQUIRED`),
    sourceMode: requireString(record.sourceMode, `${codePrefix}_SOURCE_MODE_REQUIRED`),
    status: requireEnum(record.status, ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const, `${codePrefix}_STATUS_REQUIRED`),
    packageVersion: record.packageVersion == null ? null : optionalString(record.packageVersion) ?? null,
    releaseId: record.releaseId == null ? null : optionalString(record.releaseId) ?? null,
    releaseVersion: record.releaseVersion == null ? null : requireNumber(record.releaseVersion, `${codePrefix}_RELEASE_VERSION_REQUIRED`),
    qualityGateStatus: record.qualityGateStatus == null
      ? null
      : requireEnum(record.qualityGateStatus, ['PASS', 'WARN', 'FAIL', 'BYPASSED'] as const, `${codePrefix}_QUALITY_GATE_STATUS_REQUIRED`),
    qualityGateSummary: record.qualityGateSummary == null
      ? null
      : normalizeQualityGateSummary(record.qualityGateSummary, `${codePrefix}_QUALITY_GATE_SUMMARY`),
    retryCount: requireNumber(record.retryCount, `${codePrefix}_RETRY_COUNT_REQUIRED`),
    lastError: record.lastError == null ? null : optionalString(record.lastError) ?? null,
    startedAt: record.startedAt == null ? null : optionalString(record.startedAt) ?? null,
    finishedAt: record.finishedAt == null ? null : optionalString(record.finishedAt) ?? null,
    createdAt: requireString(record.createdAt, `${codePrefix}_CREATED_AT_REQUIRED`),
    updatedAt: requireString(record.updatedAt, `${codePrefix}_UPDATED_AT_REQUIRED`),
  };
}

function normalizeOfficialFactoryBatchRun(value: unknown): ForgeOfficialFactoryBatchRun {
  const record = requireRecord(value, 'FORGE_WORLD_BATCH_RUN_INVALID');
  return {
    id: requireString(record.id, 'FORGE_WORLD_BATCH_RUN_ID_REQUIRED'),
    name: requireString(record.name, 'FORGE_WORLD_BATCH_RUN_NAME_REQUIRED'),
    requestKey: record.requestKey == null ? null : optionalString(record.requestKey) ?? null,
    requestedBy: requireString(record.requestedBy, 'FORGE_WORLD_BATCH_RUN_REQUESTED_BY_REQUIRED'),
    status: requireEnum(record.status, ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED'] as const, 'FORGE_WORLD_BATCH_RUN_STATUS_REQUIRED'),
    pipelineStages: optionalStringArray(record.pipelineStages, 'FORGE_WORLD_BATCH_RUN_PIPELINE_STAGES_REQUIRED') ?? [],
    retryLimit: requireNumber(record.retryLimit, 'FORGE_WORLD_BATCH_RUN_RETRY_LIMIT_REQUIRED'),
    retryCount: requireNumber(record.retryCount, 'FORGE_WORLD_BATCH_RUN_RETRY_COUNT_REQUIRED'),
    batchItemCount: requireNumber(record.batchItemCount, 'FORGE_WORLD_BATCH_RUN_BATCH_ITEM_COUNT_REQUIRED'),
    successCount: requireNumber(record.successCount, 'FORGE_WORLD_BATCH_RUN_SUCCESS_COUNT_REQUIRED'),
    failureCount: requireNumber(record.failureCount, 'FORGE_WORLD_BATCH_RUN_FAILURE_COUNT_REQUIRED'),
    qualityGateStatus: record.qualityGateStatus == null
      ? null
      : requireEnum(record.qualityGateStatus, ['PASS', 'WARN', 'FAIL', 'BYPASSED'] as const, 'FORGE_WORLD_BATCH_RUN_QUALITY_GATE_STATUS_REQUIRED'),
    qualityGateSummary: record.qualityGateSummary == null
      ? null
      : normalizeQualityGateSummary(record.qualityGateSummary, 'FORGE_WORLD_BATCH_RUN_QUALITY_GATE_SUMMARY'),
    lastError: record.lastError == null ? null : optionalString(record.lastError) ?? null,
    lastReleaseId: record.lastReleaseId == null ? null : optionalString(record.lastReleaseId) ?? null,
    executionNotes: record.executionNotes == null ? null : optionalString(record.executionNotes) ?? null,
    startedAt: record.startedAt == null ? null : optionalString(record.startedAt) ?? null,
    finishedAt: record.finishedAt == null ? null : optionalString(record.finishedAt) ?? null,
    createdAt: requireString(record.createdAt, 'FORGE_WORLD_BATCH_RUN_CREATED_AT_REQUIRED'),
    updatedAt: requireString(record.updatedAt, 'FORGE_WORLD_BATCH_RUN_UPDATED_AT_REQUIRED'),
    items: Array.isArray(record.items)
      ? record.items.map((item) => normalizeOfficialFactoryBatchItem(item, 'FORGE_WORLD_BATCH_ITEM'))
      : [],
  };
}

function normalizeOfficialWorldTitleLineage(value: unknown): ForgeOfficialWorldTitleLineage {
  const record = requireRecord(value, 'FORGE_WORLD_TITLE_LINEAGE_INVALID');
  return {
    id: requireString(record.id, 'FORGE_WORLD_TITLE_LINEAGE_ID_REQUIRED'),
    worldId: record.worldId == null ? null : optionalString(record.worldId) ?? null,
    slug: requireString(record.slug, 'FORGE_WORLD_TITLE_LINEAGE_SLUG_REQUIRED'),
    sourceTitle: requireString(record.sourceTitle, 'FORGE_WORLD_TITLE_LINEAGE_SOURCE_TITLE_REQUIRED'),
    canonicalTitle: requireString(record.canonicalTitle, 'FORGE_WORLD_TITLE_LINEAGE_CANONICAL_TITLE_REQUIRED'),
    titleLineageKey: requireString(record.titleLineageKey, 'FORGE_WORLD_TITLE_LINEAGE_KEY_REQUIRED'),
    packageVersion: record.packageVersion == null ? null : optionalString(record.packageVersion) ?? null,
    releaseId: record.releaseId == null ? null : optionalString(record.releaseId) ?? null,
    runId: record.runId == null ? null : optionalString(record.runId) ?? null,
    itemId: record.itemId == null ? null : optionalString(record.itemId) ?? null,
    recordedBy: requireString(record.recordedBy, 'FORGE_WORLD_TITLE_LINEAGE_RECORDED_BY_REQUIRED'),
    reason: record.reason == null ? null : optionalString(record.reason) ?? null,
    createdAt: requireString(record.createdAt, 'FORGE_WORLD_TITLE_LINEAGE_CREATED_AT_REQUIRED'),
  };
}

function normalizePublishWorldPackageResult(value: unknown): ForgePublishWorldPackageResult {
  const record = requireRecord(value, 'FORGE_PACKAGE_PUBLISH_RESPONSE_INVALID');
  return {
    slug: requireString(record.slug, 'FORGE_PACKAGE_PUBLISH_SLUG_REQUIRED'),
    worldId: requireString(record.worldId, 'FORGE_PACKAGE_PUBLISH_WORLD_ID_REQUIRED'),
    worldName: requireString(record.worldName, 'FORGE_PACKAGE_PUBLISH_WORLD_NAME_REQUIRED'),
    packageVersion: requireString(record.packageVersion, 'FORGE_PACKAGE_PUBLISH_VERSION_REQUIRED'),
    mode: requireEnum(record.mode, ['upsert-sync', 'reset-init'] as const, 'FORGE_PACKAGE_PUBLISH_MODE_REQUIRED'),
    actionCount: requireNumber(record.actionCount, 'FORGE_PACKAGE_PUBLISH_ACTION_COUNT_REQUIRED'),
    publishedBy: requireString(record.publishedBy, 'FORGE_PACKAGE_PUBLISH_ACTOR_REQUIRED'),
    release: normalizeWorldRelease(record.release, 'FORGE_PACKAGE_PUBLISH_RELEASE'),
  };
}

function normalizeRollbackWorldReleaseResult(value: unknown): ForgeRollbackWorldReleaseResult {
  const record = requireRecord(value, 'FORGE_WORLD_RELEASE_ROLLBACK_RESPONSE_INVALID');
  return {
    worldId: requireString(record.worldId, 'FORGE_WORLD_RELEASE_ROLLBACK_WORLD_ID_REQUIRED'),
    rollbackTargetReleaseId: requireString(record.rollbackTargetReleaseId, 'FORGE_WORLD_RELEASE_ROLLBACK_TARGET_REQUIRED'),
    release: normalizeWorldRelease(record.release, 'FORGE_WORLD_RELEASE_ROLLBACK_RELEASE'),
  };
}

function getAdminAuthContext() {
  const realmBaseUrl = String(useAppStore.getState().runtimeDefaults?.realm?.realmBaseUrl || '').trim();
  if (!realmBaseUrl) {
    throw new Error('FORGE_REALM_BASE_URL_REQUIRED');
  }
  const token = String(useAppStore.getState().auth?.token || '').trim();
  if (!token) {
    throw new Error('FORGE_AUTH_TOKEN_REQUIRED');
  }
  return { realmBaseUrl, token };
}

async function requestAdminWorldGovernance(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const { realmBaseUrl, token } = getAdminAuthContext();
  const response = await fetch(`${realmBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const parsed = await parseJsonResponse(response);

  if (!response.ok) {
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const message = record && typeof record.message === 'string'
      ? record.message
      : `FORGE_WORLD_GOVERNANCE_REQUEST_FAILED:${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

export async function publishWorldPackage(
  payload: ForgePublishWorldPackageInput,
): Promise<ForgePublishWorldPackageResult> {
  const parsed = await requestAdminWorldGovernance('/api/admin/worlds/packages/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizePublishWorldPackageResult(parsed);
}

export async function listWorldReleases(worldId: string): Promise<ForgeWorldRelease[]> {
  const parsed = await requestAdminWorldGovernance(`/api/admin/worlds/${encodeURIComponent(worldId)}/releases`);
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_WORLD_RELEASE_LIST_INVALID');
  }
  return parsed.map((entry) => normalizeWorldRelease(entry, 'FORGE_WORLD_RELEASE_LIST_ITEM'));
}

export async function getWorldRelease(worldId: string, releaseId: string): Promise<ForgeWorldRelease> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/${encodeURIComponent(worldId)}/releases/${encodeURIComponent(releaseId)}`,
  );
  return normalizeWorldRelease(parsed, 'FORGE_WORLD_RELEASE_DETAIL');
}

export async function rollbackWorldRelease(
  worldId: string,
  releaseId: string,
  payload: ForgeRollbackWorldReleaseInput,
): Promise<ForgeRollbackWorldReleaseResult> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/${encodeURIComponent(worldId)}/releases/${encodeURIComponent(releaseId)}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return normalizeRollbackWorldReleaseResult(parsed);
}

export async function listOfficialFactoryBatchRuns(): Promise<ForgeOfficialFactoryBatchRun[]> {
  const parsed = await requestAdminWorldGovernance('/api/admin/worlds/operations/batch-runs');
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_WORLD_BATCH_RUN_LIST_INVALID');
  }
  return parsed.map((entry) => normalizeOfficialFactoryBatchRun(entry));
}

export async function createOfficialFactoryBatchRun(
  payload: ForgeCreateOfficialFactoryBatchRunInput,
): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance('/api/admin/worlds/operations/batch-runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function getOfficialFactoryBatchRun(runId: string): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/operations/batch-runs/${encodeURIComponent(runId)}`,
  );
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function retryOfficialFactoryBatchRun(
  runId: string,
  payload: { reason?: string },
): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/operations/batch-runs/${encodeURIComponent(runId)}/retry`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function reportOfficialFactoryBatchItemFailure(
  runId: string,
  itemId: string,
  payload: ForgeReportOfficialFactoryBatchItemFailureInput,
): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/operations/batch-runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/fail`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function listWorldTitleLineage(worldId: string): Promise<ForgeOfficialWorldTitleLineage[]> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/${encodeURIComponent(worldId)}/title-lineage`,
  );
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_WORLD_TITLE_LINEAGE_LIST_INVALID');
  }
  return parsed.map((entry) => normalizeOfficialWorldTitleLineage(entry));
}
