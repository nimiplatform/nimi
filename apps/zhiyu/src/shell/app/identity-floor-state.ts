import type { ZhiyuEvidence } from './evidence';

export type ZhiyuIdentityFloorStateKind = 'blocked' | 'not-admitted' | 'ready';
export type ZhiyuIdentityFloorItemState = 'ready' | 'blocked' | 'not-admitted';

export type ZhiyuIdentityFloorItem = {
  readonly key:
    | 'platform'
    | 'local-agent'
    | 'conversation-anchor'
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
  readonly title: '身份保护';
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
  const outputFirewall = evidence.delegation?.outputFirewall ?? {
    state: 'not_projected' as const,
    reasonCode: 'runtime-delegation-firewall-not-projected',
  };
  const delegationSource = evidence.delegation?.source ?? 'not_projected';
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
      key: 'output-firewall',
      title: '输出防火墙解释',
      owner: '委托输出防护',
      state: outputFirewallItemState(outputFirewall.state),
      reasonCode: outputFirewall.reasonCode,
      actionHint: outputFirewall.state !== 'not_projected'
        ? 'inspect_runtime_delegation_firewall_projection'
        : 'admit_runtime_delegation_firewall_user_projection',
      sourceRule: 'K-DELEG-050..K-DELEG-084',
      source: delegationSource,
    },
    {
      key: 'prompt-injection',
      title: '指令注入冲突状态',
      owner: '平台与本地服务',
      state: 'not-admitted',
      reasonCode: 'runtime-agent-firewall-threat-indicators-not-projected',
      actionHint: 'admit_identity_floor_conflict_projection',
      sourceRule: 'P-AGID-*;K-DELEG-067',
      source: 'not_projected',
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
    title: '身份保护',
    state,
    summaryReasonCode: firstBlocked?.reasonCode
      ?? (notAdmittedCount > 0 ? 'zhiyu-identity-floor-user-visible-projection-not-admitted' : 'zhiyu-identity-floor-ready'),
    actionHint: firstBlocked?.actionHint
      ?? (notAdmittedCount > 0 ? 'admit_identity_floor_projection' : 'inspect_identity_floor_projection'),
    readyCount,
    blockedCount,
    notAdmittedCount,
    items,
    unsupportedProjectionFields: [
      'firewallThreatIndicators',
      'firewallNormalizedOutputDiff',
    ],
  };
}

function outputFirewallItemState(
  state: ZhiyuEvidence['delegation']['outputFirewall']['state'] | undefined,
): ZhiyuIdentityFloorItemState {
  switch (state) {
    case 'accepted':
      return 'ready';
    case 'approval-required':
    case 'blocked':
    case 'quarantined':
      return 'blocked';
    case 'not_projected':
    default:
      return 'not-admitted';
  }
}
