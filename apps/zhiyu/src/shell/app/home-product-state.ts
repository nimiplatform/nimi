import type { ZhiyuEvidence } from './evidence';

export type ZhiyuHomeProductStage =
  | 'runtime-unavailable'
  | 'account-required'
  | 'source-required'
  | 'agent-required'
  | 'conversation-required'
  | 'route-required'
  | 'ready';

export type ZhiyuHomeStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type ZhiyuHomeStatusCard = {
  readonly key: string;
  readonly title: string;
  readonly label: string;
  readonly ready: boolean;
  readonly tone: ZhiyuHomeStatusTone;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
};

export type ZhiyuHomeGatedSurface = {
  readonly key: 'memory' | 'capability' | 'proposal' | 'delegation' | 'identity' | 'companion' | 'diary' | 'avatar';
  readonly title: string;
  readonly description: string;
  readonly stateLabel: string;
  readonly reasonCode: string;
  readonly actionHint: string;
};

export type ZhiyuHomeProductState = {
  readonly stage: ZhiyuHomeProductStage;
  readonly primaryTitle: string;
  readonly primaryDescription: string;
  readonly primaryActionHint: string;
  readonly readyCount: number;
  readonly totalCount: number;
  readonly readinessScore: string;
  readonly statusCards: readonly ZhiyuHomeStatusCard[];
  readonly gatedSurfaces: readonly ZhiyuHomeGatedSurface[];
};

type EvidenceStatus = {
  readonly ready: boolean;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
};

export function projectZhiyuHomeProductState(evidence: ZhiyuEvidence): ZhiyuHomeProductState {
  const statusCards = [
    statusCard('runtime', 'Runtime', evidence.runtime, '本地运行时'),
    statusCard('auth', '账户', evidence.auth, '身份与权限'),
    statusCard('source', '来源投影', evidence.source, '准入来源'),
    statusCard('inventory', 'Agent 清单', evidence.inventory, 'Runtime inventory'),
    statusCard('localAgent', 'LocalAgent', evidence.localAgent, '本地身份'),
    statusCard('conversation', '会话锚点', evidence.conversation, 'Runtime anchor'),
    statusCard('route', '模型路由', evidence.route, 'text.generate'),
    statusCard('turn', '回合通路', evidence.turn, 'turn readiness'),
  ] as const;
  const totalCount = statusCards.length;
  const readyCount = statusCards.filter((card) => card.ready).length;
  const stage = resolveStage(evidence);
  const blocking = statusCards.find((card) => !card.ready);
  const primary = primaryCopy(stage);

  return {
    stage,
    primaryTitle: primary.title,
    primaryDescription: primary.description,
    primaryActionHint: blocking?.actionHint ?? 'send_runtime_agent_turn',
    readyCount,
    totalCount,
    readinessScore: `${readyCount}/${totalCount}`,
    statusCards,
    gatedSurfaces: gatedSurfaces(evidence),
  };
}

function statusCard(
  key: string,
  title: string,
  status: EvidenceStatus,
  label: string,
): ZhiyuHomeStatusCard {
  return {
    key,
    title,
    label,
    ready: status.ready,
    tone: status.ready ? 'success' : toneForReason(status.reasonCode),
    reasonCode: status.reasonCode,
    actionHint: status.actionHint,
    source: status.source,
  };
}

function toneForReason(reasonCode: string): ZhiyuHomeStatusTone {
  if (reasonCode === 'not-probed') {
    return 'neutral';
  }
  if (reasonCode === 'electron-runtime-endpoint-unavailable') {
    return 'danger';
  }
  if (reasonCode.includes('required') || reasonCode.includes('unavailable')) {
    return 'warning';
  }
  return 'info';
}

function resolveStage(evidence: ZhiyuEvidence): ZhiyuHomeProductStage {
  if (!evidence.runtime.ready) {
    return 'runtime-unavailable';
  }
  if (!evidence.auth.ready) {
    return 'account-required';
  }
  if (!evidence.source.ready) {
    return 'source-required';
  }
  if (!evidence.localAgent.ready) {
    return 'agent-required';
  }
  if (!evidence.conversation.ready) {
    return 'conversation-required';
  }
  if (!evidence.route.ready || !evidence.turn.ready) {
    return 'route-required';
  }
  return 'ready';
}

function primaryCopy(stage: ZhiyuHomeProductStage): {
  readonly title: string;
  readonly description: string;
} {
  switch (stage) {
    case 'runtime-unavailable':
      return {
        title: '织羽正在等待本地 Runtime',
        description: '本地运行时还没有连上，织羽不会伪造 Agent、会话或回复。',
      };
    case 'account-required':
      return {
        title: '织羽正在确认账户身份',
        description: '账户投影未就绪前，Home 只展示只读状态和修复方向。',
      };
    case 'source-required':
      return {
        title: '织羽正在等待准入来源',
        description: 'LocalAgent 必须来自 Runtime/SDK 准入投影，不能在应用内写死来源。',
      };
    case 'agent-required':
      return {
        title: '织羽正在寻找 Runtime-owned LocalAgent',
        description: '当 Runtime inventory 或 source provenance 命中后，才会进入会话。',
      };
    case 'conversation-required':
      return {
        title: '织羽正在打开会话锚点',
        description: '提交回合前必须先获得 Runtime-owned conversation anchor。',
      };
    case 'route-required':
      return {
        title: '织羽正在等待模型路由',
        description: '没有已准入的 text.generate 绑定时，输入会保持禁用。',
      };
    case 'ready':
      return {
        title: '织羽已准备好与本地 Agent 交互',
        description: '当前会话、路由和回合通路均来自 Runtime/SDK 投影。',
      };
  }
}

function gatedSurfaces(evidence: ZhiyuEvidence): readonly ZhiyuHomeGatedSurface[] {
  return [
    {
      key: 'memory',
      title: '记忆观测',
      description: '只显示未来 Cognition/Runtime 准入的只读记忆投影；当前不写入、不缓存、不伪造记忆。',
      stateLabel: evidence.conversation.ready ? '等待记忆投影准入' : '等待会话锚点',
      reasonCode: evidence.conversation.reasonCode,
      actionHint: evidence.conversation.actionHint,
    },
    {
      key: 'capability',
      title: '能力房间',
      description: '能力、权限、模型出站和本地动作都必须来自 canonical projection；当前只展示门禁状态。',
      stateLabel: evidence.route.ready ? '等待能力目录准入' : '等待模型路由',
      reasonCode: evidence.route.reasonCode,
      actionHint: evidence.route.actionHint,
    },
    {
      key: 'proposal',
      title: 'Proposal Intake',
      description: 'Conversation-originated capability requests become Platform-owned non-executing proposals through the SDK. Zhiyu never stores proposal truth locally.',
      stateLabel: evidence.proposal.ready ? 'Proposal submitted to Platform intake' : 'Waiting for Platform proposal intake',
      reasonCode: evidence.proposal.reasonCode,
      actionHint: evidence.proposal.actionHint,
    },
    {
      key: 'delegation',
      title: 'Delegation UX',
      description: 'Runtime-owned delegated approval, output firewall, and replay audit surface. Zhiyu reviews and submits typed decisions only.',
      stateLabel: evidence.delegation.ready
        ? 'Runtime delegation control projected'
        : 'Waiting for Runtime delegation control',
      reasonCode: evidence.delegation.reasonCode,
      actionHint: evidence.delegation.actionHint,
    },
    {
      key: 'identity',
      title: '身份地板',
      description: '只读展示 agent identity floor、conversation anchor 连续性，以及尚未准入的身份冲突、防火墙和记忆准入解释投影。',
      stateLabel: evidence.localAgent.ready ? '等待用户可见身份安全投影准入' : '等待 Runtime-owned LocalAgent',
      reasonCode: evidence.localAgent.ready
        ? 'zhiyu-identity-floor-user-visible-projection-not-admitted'
        : evidence.localAgent.reasonCode,
      actionHint: evidence.localAgent.ready ? 'admit_identity_floor_projection' : evidence.localAgent.actionHint,
    },
    {
      key: 'companion',
      title: '相处状态',
      description: '只读展示 Runtime Agent state projection；emotion、posture、relationship、why-now、user adjustment 和 history 未准入时明确标记。',
      stateLabel: evidence.companion.ready
        ? 'Runtime Agent state 已投影'
        : '等待 Runtime Agent state projection',
      reasonCode: evidence.companion.reasonCode,
      actionHint: evidence.companion.actionHint,
    },
    {
      key: 'diary',
      title: 'Diary & Reflection',
      description: 'Read-only long-term artifact lane. Zhiyu shows the missing owner, storage policy, and SDK projection instead of creating a local diary store.',
      stateLabel: evidence.diaryReflection.ready
        ? 'Diary reflection artifacts projected'
        : 'Waiting for diary reflection artifact authority',
      reasonCode: evidence.diaryReflection.reasonCode,
      actionHint: evidence.diaryReflection.actionHint,
    },
    {
      key: 'avatar',
      title: 'Avatar Presence',
      description: '只读展示 admitted Avatar facade projection；配置 ref、启动入口和管理入口均必须由上游 facade 提供。',
      stateLabel: evidence.avatar.ready ? 'Avatar facade 已投影' : '等待 Avatar facade projection',
      reasonCode: evidence.avatar.reasonCode,
      actionHint: evidence.avatar.actionHint,
    },
  ];
}
