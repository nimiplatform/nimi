import type { ZhiyuDiaryReflectionStatus } from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from './local-agent-discovery';

const ARTIFACT_CLASSES = [
  'user-authored-note',
  'agent-generated-reflection',
  'memory-derived-summary',
  'system-generated-audit-summary',
] as const;

const REQUIRED_FIELDS = [
  'artifact_id',
  'artifact_class',
  'owner_domain',
  'created_timestamp',
  'generated_approved_reviewed_status',
  'source_anchor',
  'storage_policy_ref',
  'retention_or_export_state',
] as const;

const MISSING_OWNER = 'cognition-runtime-diary-reflection-artifact-owner';
const MISSING_STORAGE_POLICY = 'platform-diary-reflection-retention-export-policy';
const MISSING_SDK_PROJECTION = 'sdk-runtime-diary-reflection-artifact-projection';

export function projectZhiyuDiaryReflectionArtifacts(
  localAgent?: Pick<ZhiyuLocalAgentStatus, 'ready' | 'ownerUserId' | 'runtimeSourceRef' | 'localAgentRef'>,
): ZhiyuDiaryReflectionStatus {
  const identity = localAgent?.ready ? localAgent : undefined;
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'deferred',
    reasonCode: 'zhiyu-diary-reflection-artifact-authority-not-admitted',
    actionHint: 'admit_diary_reflection_artifact_projection',
    source: 'renderer',
    message: 'Diary and reflection artifact projection is deferred until Cognition/Runtime owner metadata, Platform retention/export policy, and SDK projection are admitted.',
    ownerUserId: identity?.ownerUserId ?? null,
    runtimeSourceRef: identity?.runtimeSourceRef ?? null,
    localAgentRef: identity?.localAgentRef ?? null,
    missingOwner: MISSING_OWNER,
    missingStoragePolicyRef: MISSING_STORAGE_POLICY,
    missingSdkProjection: MISSING_SDK_PROJECTION,
    artifactClasses: [...ARTIFACT_CLASSES],
    requiredFields: [...REQUIRED_FIELDS],
    unsupportedFields: ['diary_reflection_artifact_projection'],
    artifacts: [],
  };
}
