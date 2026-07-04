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
    statusCard('runtime', '本地服务', evidence.runtime, '桌面连接'),
    statusCard('auth', '账户', evidence.auth, '身份与权限'),
    statusCard('source', '伙伴来源', evidence.source, 'Realm 角色资料'),
    statusCard('inventory', '伙伴清单', evidence.inventory, '可用伙伴'),
    statusCard('localAgent', '当前伙伴', evidence.localAgent, '本地身份'),
    statusCard('conversation', '会话', evidence.conversation, '对话入口'),
    statusCard('route', '模型配置', evidence.route, '文字模型'),
    statusCard('turn', '回复', evidence.turn, '消息发送'),
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
    primaryActionHint: primary.actionHint,
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
  if (!evidence.source.ready && !evidence.localAgent.ready) {
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
  readonly actionHint: string;
} {
  switch (stage) {
    case 'runtime-unavailable':
      return {
        title: '需要先连接本地服务',
        description: '连接后，织羽会读取 Realm 角色资料，并打开对应的本地伙伴。',
        actionHint: '先确认桌面本地服务已经启动。',
      };
    case 'account-required':
      return {
        title: '需要先登录账户',
        description: '账户确认后，才可以读取你的 Realm 伙伴资料。',
        actionHint: '请完成账户登录或重新检查账户状态。',
      };
    case 'source-required':
      return {
        title: '选择已存在伙伴',
        description: '当前没有可打开的伙伴。请到 Desktop Explore 的角色/人格页选择来源；等本地伙伴出现在清单后，织羽会打开它。',
        actionHint: '打开 Desktop Explore 的角色/人格语境；织羽只读取已在本地清单中的伙伴。',
      };
    case 'agent-required':
      return {
        title: '选择已存在伙伴',
        description: '已经连接到账户，但当前没有可打开的伙伴。请从 Desktop Explore 的角色/人格页确认来源后返回。',
        actionHint: '打开 Desktop Explore 的角色/人格语境；织羽只读取已在本地清单中的伙伴。',
      };
    case 'conversation-required':
      return {
        title: '正在打开当前伙伴会话',
        description: '当前伙伴已选定，正在准备对话入口。',
        actionHint: '稍候片刻，或打开诊断查看阻塞原因。',
      };
    case 'route-required':
      return {
        title: '需要先配置模型',
        description: '当前伙伴已经选定；配置文字模型后，就可以开始对话。',
        actionHint: '打开模型配置，选择用于对话的本地或云端模型。',
      };
    case 'ready':
      return {
        title: '当前伙伴已准备好',
        description: '可以开始对话，并查看记忆、形象和可用能力摘要。',
        actionHint: '直接输入消息，或查看本地环境状态。',
      };
  }
}

function gatedSurfaces(evidence: ZhiyuEvidence): readonly ZhiyuHomeGatedSurface[] {
  return [
    {
      key: 'memory',
      title: '记忆观测',
      description: '只读展示当前伙伴的记忆摘要；没有数据时不会伪造记忆。',
      stateLabel: evidence.conversation.ready ? '等待记忆摘要' : '等待当前伙伴会话',
      reasonCode: evidence.conversation.reasonCode,
      actionHint: evidence.conversation.actionHint,
    },
    {
      key: 'capability',
      title: '能力面板',
      description: '用于诊断当前可用能力、模型配置和权限边界。',
      stateLabel: evidence.route.ready ? '能力目录可查看' : '等待模型配置',
      reasonCode: evidence.route.reasonCode,
      actionHint: evidence.route.actionHint,
    },
    {
      key: 'proposal',
      title: '能力申请',
      description: '对话中产生的新能力请求会进入受控申请流程。',
      stateLabel: evidence.proposal.ready ? '申请已提交' : '申请入口未开放',
      reasonCode: evidence.proposal.reasonCode,
      actionHint: evidence.proposal.actionHint,
    },
    {
      key: 'delegation',
      title: '委托审批',
      description: '只显示受控委托、输出防护和回放审计。',
      stateLabel: evidence.delegation.ready
        ? '委托控制可用'
        : '等待委托控制开放',
      reasonCode: evidence.delegation.reasonCode,
      actionHint: evidence.delegation.actionHint,
    },
    {
      key: 'identity',
      title: '身份安全',
      description: '只读展示伙伴身份、会话连续性和安全边界。',
      stateLabel: evidence.localAgent.ready ? '等待身份安全说明' : '等待当前伙伴',
      reasonCode: evidence.localAgent.ready
        ? 'zhiyu-identity-floor-user-visible-projection-not-admitted'
        : evidence.localAgent.reasonCode,
      actionHint: evidence.localAgent.ready ? 'admit_identity_floor_projection' : evidence.localAgent.actionHint,
    },
    {
      key: 'companion',
      title: '相处状态',
      description: '展示当前伙伴的状态、情绪和参与方式摘要。',
      stateLabel: evidence.companion.ready
        ? '伙伴状态已更新'
        : '等待伙伴状态',
      reasonCode: evidence.companion.reasonCode,
      actionHint: evidence.companion.actionHint,
    },
    {
      key: 'diary',
      title: '日记与回顾',
      description: '长期内容与回顾能力尚在受控开放中，不在本地创建日记仓库。',
      stateLabel: evidence.diaryReflection.ready
        ? '日记与回顾已可用'
        : '等待日记与回顾授权',
      reasonCode: evidence.diaryReflection.reasonCode,
      actionHint: evidence.diaryReflection.actionHint,
    },
    {
      key: 'avatar',
      title: '形象状态',
      description: '展示当前伙伴形象是否可启动、可管理。',
      stateLabel: evidence.avatar.ready ? '形象已就绪' : '等待形象授权',
      reasonCode: evidence.avatar.reasonCode,
      actionHint: evidence.avatar.actionHint,
    },
  ];
}
