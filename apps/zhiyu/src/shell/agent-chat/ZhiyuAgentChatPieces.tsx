import {
  AlertTriangle,
  Lightbulb,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { partnerInitial } from './ZhiyuAgentChatLabels';

export function behaviorModeTitle(mode: 'off' | 'low' | 'medium' | 'high') {
  if (mode === 'low') {
    return '低';
  }
  if (mode === 'medium') {
    return '平衡';
  }
  if (mode === 'high') {
    return '活跃';
  }
  return '关闭';
}

export function behaviorModeSubtitle(mode: 'off' | 'low' | 'medium' | 'high') {
  if (mode === 'low') {
    return '少量主动';
  }
  if (mode === 'medium') {
    return '每日节奏';
  }
  if (mode === 'high') {
    return '高频参与';
  }
  return '只在被对话时回应';
}

export function ComposerAvatarButton({
  currentPartnerName,
  currentPartnerAvatarUrl,
  hasCurrentPartner,
  onOpenSettings,
}: {
  readonly currentPartnerName: string;
  readonly currentPartnerAvatarUrl: string | null;
  readonly hasCurrentPartner: boolean;
  readonly onOpenSettings: () => void;
}) {
  return (
    <button
      type="button"
      className="zhiyu-home__composer-avatar"
      aria-label={hasCurrentPartner ? `形象：${currentPartnerName}` : '选择本地伙伴'}
      title={hasCurrentPartner ? `形象：${currentPartnerName}` : '选择本地伙伴'}
      onClick={onOpenSettings}
    >
      {currentPartnerAvatarUrl ? (
        <img
          src={currentPartnerAvatarUrl}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
        />
      ) : partnerInitial(currentPartnerName)}
    </button>
  );
}

export function ComposerModeTools({
  avatarLaunchAction,
  onAvatarLaunch,
  onOpenAppearance,
  onOpenBehavior,
}: {
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly onAvatarLaunch?: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenBehavior: () => void;
}) {
  const avatarReady = avatarLaunchAction.state === 'ready' && Boolean(onAvatarLaunch);
  return (
    <>
      <button
        type="button"
        aria-label={avatarReady ? '启动形象' : '配置形象'}
        title={avatarReady ? '启动形象' : '配置形象'}
        data-zhiyu-composer-tool="avatar"
        data-zhiyu-avatar-launch-entry={avatarLaunchAction.state}
        data-zhiyu-avatar-launch-reason={avatarLaunchAction.reasonCode}
        onClick={() => {
          if (avatarReady && onAvatarLaunch) {
            onAvatarLaunch();
            return;
          }
          onOpenAppearance();
        }}
      >
        <UserRound size={16} aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        data-zhiyu-composer-toolbar-divider="true"
        className="mx-0.5 h-4 w-px bg-[var(--nimi-border-subtle)]"
      />
      <button type="button" aria-label="主动模式" title="主动模式" data-zhiyu-composer-tool="proactive" onClick={onOpenBehavior}>
        <Lightbulb size={16} aria-hidden="true" />
      </button>
    </>
  );
}

export function ComposerAgentCenterButton({
  open,
  onToggleAgentPanel,
}: {
  readonly open: boolean;
  readonly onToggleAgentPanel: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="伙伴中心"
      aria-pressed={open}
      title={open ? '关闭伙伴中心' : '伙伴中心'}
      data-nimi-semantic-id="zhiyu-primary-action"
      data-zhiyu-composer-tool="agent"
      data-zhiyu-composer-agent-center-state={open ? 'open' : 'closed'}
      onClick={onToggleAgentPanel}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
    </button>
  );
}

export function RuntimeChatFailureNotice({
  chat,
  onOpenSettings,
  onReopen,
}: {
  readonly chat: ZhiyuEvidence['chat'];
  readonly onOpenSettings?: () => void;
  readonly onReopen?: () => void;
}) {
  const reason = chat.reasonCode?.toUpperCase().replaceAll('-', '_');
  const configurationRequired = reason === 'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED';
  const unsupported = reason === 'AI_TEXT_BEHAVIOR_UNSUPPORTED';
  return (
    <section
      className="zhiyu-home__chat-failure-notice"
      data-zhiyu-agent-chat-failure="true"
      data-zhiyu-agent-chat-failure-reason={chat.reasonCode}
      data-zhiyu-agent-chat-failure-action={chat.actionHint}
      aria-live="polite"
      aria-label="伙伴回复失败"
    >
      <div className="zhiyu-home__chat-failure-mark" aria-hidden="true">
        <AlertTriangle size={17} />
      </div>
      <div className="zhiyu-home__chat-failure-copy">
        <span>回复失败</span>
        <strong>回复暂时没有完成</strong>
        <p>{configurationRequired
          ? '这项任务还没有就绪的模型，请先到 Nimi 的「AI 能力」完成设置。'
          : unsupported
            ? '当前模型不支持这次任务需要的行为，请在 Nimi 的「AI 能力」选择支持该任务的配置。'
            : '请重新打开会话后重试。已有消息会保留，重新打开不会自动发送。'}</p>
        {(configurationRequired || unsupported) && onOpenSettings ? <button type="button" onClick={onOpenSettings}>打开 AI 能力</button> : null}
        {onReopen ? <button type="button" onClick={onReopen}>重新打开会话</button> : null}
        <details><summary>技术详情</summary><p>{chat.reasonCode}</p><p>{chat.message}</p></details>
      </div>
    </section>
  );
}
