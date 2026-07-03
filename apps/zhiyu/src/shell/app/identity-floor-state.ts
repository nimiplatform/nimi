import type { ZhiyuEvidence } from './evidence';

export type ZhiyuIdentityFloorStateKind = 'blocked' | 'not-admitted' | 'ready';
export type ZhiyuIdentityFloorItemState = 'ready' | 'blocked' | 'not-admitted';

export type ZhiyuIdentityFloorItem = {
  readonly key:
    | 'platform'
    | 'local-agent'
    | 'conversation-anchor'
    | 'identity-conflict'
    | 'memory-admission'
    | 'output-firewall'
    | 'prompt-injection';
  readonly title: string;
  readonly owner: string;
  readonly state: ZhiyuIdentityFloorItemState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly sourceRule: string;
  readonly source: string;
};

export type ZhiyuIdentityFloorState = {
  readonly title: '身份地板';
  readonly state: ZhiyuIdentityFloorStateKind;
  readonly summaryReasonCode: string;
  readonly actionHint: string;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly notAdmittedCount: number;
  readonly items: readonly ZhiyuIdentityFloorItem[];
  readonly unsupportedProjectionFields: readonly string[];
};

export function projectZhiyuIdentityFloorState(evidence: ZhiyuEvidence): ZhiyuIdentityFloorState {
  const safety = evidence.identitySafety;
  const items: readonly ZhiyuIdentityFloorItem[] = [
    {
      key: 'platform',
      title: '平台身份规则',
      owner: '平台身份规则',
      state: 'ready',
      reasonCode: 'P-AGID-001..P-AGID-008',
      actionHint: 'consume_platform_identity_floor_contract',
      sourceRule: 'P-AGID-*',
      source: 'platform-agent-identity-floor-contract',
    },
    {
      key: 'local-agent',
      title: '本地伙伴身份',
      owner: '本地伙伴服务',
      state: evidence.localAgent.ready ? 'ready' : 'blocked',
      reasonCode: evidence.localAgent.reasonCode,
      actionHint: evidence.localAgent.actionHint,
      sourceRule: 'K-AGCORE-001;K-AGCORE-139',
      source: evidence.localAgent.source,
    },
    {
      key: 'conversation-anchor',
      title: '会话连续性锚点',
      owner: '本地伙伴服务',
      state: evidence.conversation.ready ? 'ready' : 'blocked',
      reasonCode: evidence.conversation.reasonCode,
      actionHint: evidence.conversation.actionHint,
      sourceRule: 'P-AGID-004;K-AGCORE-006c',
      source: evidence.conversation.source,
    },
    {
      key: 'identity-conflict',
      title: '身份冲突',
      owner: '平台与本地服务',
      state: safety?.identityConflict?.state === 'detected' ? 'blocked' : 'not-admitted',
      reasonCode: safety?.identityConflict?.reasonCode ?? 'runtime-agent-identity-conflict-event-not-projected',
      actionHint: safety?.identityConflict?.state === 'detected'
        ? 'inspect_runtime_identity_conflict_projection'
        : 'admit_identity_floor_conflict_projection',
      sourceRule: 'P-AGID-*;K-AGCORE-028',
      source: safety?.identityConflict?.source ?? 'not_projected',
    },
    {
      key: 'memory-admission',
      title: '记忆准入拒绝解释',
      owner: '本地伙伴服务与记忆系统',
      state: safety?.memoryAdmission?.state === 'rejected' ? 'blocked' : 'not-admitted',
      reasonCode: safety?.memoryAdmission?.reasonCode ?? 'runtime-agent-memory-admission-rejection-not-projected',
      actionHint: safety?.memoryAdmission?.state === 'rejected'
        ? 'inspect_runtime_cognition_memory_rejection'
        : 'admit_runtime_cognition_identity_rejection_projection',
      sourceRule: 'P-AGID-007;C-APMEM-003;K-AGCORE-004',
      source: safety?.memoryAdmission?.source ?? 'not_projected',
    },
    {
      key: 'output-firewall',
      title: '输出防火墙解释',
      owner: '委托输出防护',
      state: outputFirewallItemState(safety?.outputFirewall?.state),
      reasonCode: safety?.outputFirewall?.reasonCode ?? 'runtime-agent-output-firewall-verdict-not-projected',
      actionHint: safety?.outputFirewall?.state && safety.outputFirewall.state !== 'not_projected'
        ? 'inspect_runtime_delegation_firewall_projection'
        : 'admit_runtime_delegation_firewall_user_projection',
      sourceRule: 'K-DELEG-050..K-DELEG-084',
      source: safety?.outputFirewall?.source ?? 'not_projected',
    },
    {
      key: 'prompt-injection',
      title: '指令注入冲突状态',
      owner: '平台与本地服务',
      state: safety?.promptInjection?.state === 'suppressed' ? 'blocked' : 'not-admitted',
      reasonCode: safety?.promptInjection?.reasonCode ?? 'runtime-agent-firewall-threat-indicators-not-projected',
      actionHint: safety?.promptInjection?.state === 'suppressed'
        ? 'inspect_runtime_firewall_suppression'
        : 'admit_identity_floor_conflict_projection',
      sourceRule: 'P-AGID-*;K-DELEG-067',
      source: safety?.promptInjection?.source ?? 'not_projected',
    },
  ];

  const readyCount = items.filter((item) => item.state === 'ready').length;
  const blockedCount = items.filter((item) => item.state === 'blocked').length;
  const notAdmittedCount = items.filter((item) => item.state === 'not-admitted').length;
  const firstBlocked = items.find((item) => item.state === 'blocked');
  const state: ZhiyuIdentityFloorStateKind = firstBlocked
    ? 'blocked'
    : notAdmittedCount > 0
      ? 'not-admitted'
      : 'ready';

  return {
    title: '身份地板',
    state,
    summaryReasonCode: firstBlocked?.reasonCode
      ?? (notAdmittedCount > 0 ? 'zhiyu-identity-floor-user-visible-projection-not-admitted' : 'zhiyu-identity-floor-ready'),
    actionHint: firstBlocked?.actionHint
      ?? (notAdmittedCount > 0 ? 'admit_identity_floor_projection' : 'inspect_identity_floor_projection'),
    readyCount,
    blockedCount,
    notAdmittedCount,
    items,
    unsupportedProjectionFields: safety?.unsupportedProjectionFields ?? [
      'identityConflictEvent',
      'firewallThreatIndicators',
      'firewallNormalizedOutputDiff',
    ],
  };
}

function outputFirewallItemState(
  state: NonNullable<ZhiyuEvidence['identitySafety']>['outputFirewall']['state'] | undefined,
): ZhiyuIdentityFloorItemState {
  switch (state) {
    case 'accepted':
      return 'ready';
    case 'approval_required':
    case 'blocked':
    case 'quarantined':
      return 'blocked';
    case 'not_projected':
    default:
      return 'not-admitted';
  }
}
