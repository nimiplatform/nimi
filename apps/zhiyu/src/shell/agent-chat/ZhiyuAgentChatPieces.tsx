import {
  AlertTriangle,
  Lightbulb,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { ZhiyuPartnerAvatarCard } from './ZhiyuPartnerAvatarCard';
import type { NimiLocalAppAgentHandle, NimiLocalAppAgentIntroductionClient } from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { avatarLaunchRecovery, type ZhiyuAvatarLaunchFeedback } from '../avatar/avatar-launch-feedback';
import { partnerInitial } from './ZhiyuAgentChatLabels';
import { agentConfigurationErrorMessage } from './agent-configuration-error';

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
  onOpenSettings, agentHandle, readIntroduction, onOpenPartner,
}: {
  readonly agentHandle: NimiLocalAppAgentHandle | null;
  readonly readIntroduction: NimiLocalAppAgentIntroductionClient['getIntroduction'];
  readonly onOpenPartner: (section: 'overview' | 'cognition') => void;
  readonly currentPartnerName: string;
  readonly currentPartnerAvatarUrl: string | null;
  readonly hasCurrentPartner: boolean;
  readonly onOpenSettings: () => void;
}) {
  const button = (
    <button
      type="button"
      className="zhiyu-home__composer-avatar"
      aria-label={hasCurrentPartner ? `查看${currentPartnerName}的伙伴资料` : '选择本地伙伴'}
      title={hasCurrentPartner ? `查看${currentPartnerName}的伙伴资料` : '选择本地伙伴'}
      onClick={hasCurrentPartner ? undefined : onOpenSettings}
    >
      {!hasCurrentPartner ? <UserRound size={18} aria-hidden="true" /> : currentPartnerAvatarUrl ? (
        <img
          src={currentPartnerAvatarUrl}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
        />
      ) : partnerInitial(currentPartnerName)}
    </button>
  );
  return hasCurrentPartner && agentHandle ? <ZhiyuPartnerAvatarCard agentHandle={agentHandle} name={currentPartnerName}
    avatarUrl={currentPartnerAvatarUrl} placement="composer" readIntroduction={readIntroduction} onOpen={onOpenPartner}>{button}</ZhiyuPartnerAvatarCard> : button;
}

export function ComposerModeTools({
  avatarLaunchAction,
  avatarLaunchPending = false,
  onAvatarLaunch,
  onOpenAppearance,
  onOpenBehavior,
}: {
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly avatarLaunchPending?: boolean;
  readonly onAvatarLaunch?: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenBehavior: () => void;
}) {
  const avatarReady = avatarLaunchAction.state === 'ready' && Boolean(onAvatarLaunch);
  return (
    <>
      <button
        type="button"
        aria-label={avatarLaunchPending ? '正在打开形象' : avatarReady ? '启动形象' : '配置形象'}
        title={avatarLaunchPending ? '正在打开形象' : avatarReady ? '启动形象' : '配置形象'}
        disabled={avatarLaunchPending}
        aria-busy={avatarLaunchPending}
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

export function AvatarLaunchNotice({ feedback, onRetry, onOpenAppearance, onOpenNimi, onDismiss }: {
  readonly feedback: ZhiyuAvatarLaunchFeedback;
  readonly onRetry?: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenNimi: () => void;
  readonly onDismiss?: () => void;
}) {
  const result = feedback.state === 'settled' ? feedback.result : null;
  const cancelled = result?.reasonCode === 'zhiyu-avatar-switch-cancelled';
  const failed = result?.state === 'blocked' && !cancelled;
  const checkNimi = failed && avatarLaunchRecovery(result.reasonCode) === 'nimi';
  const title = !result ? '正在打开伙伴形象…' : cancelled ? '已取消这次切换' : failed ? '未能打开伙伴形象' : '伙伴形象已打开';
  return <section className="zhiyu-avatar-launch-notice" data-zhiyu-avatar-feedback={!result ? 'pending' : failed ? 'failed' : cancelled ? 'cancelled' : 'opened'}>
    <div className="zhiyu-avatar-launch-notice__heading">
      <strong role={failed ? 'alert' : 'status'}>{title}</strong>
      {result && onDismiss ? <button type="button" aria-label="关闭形象提示" title="关闭形象提示" onClick={onDismiss}><X size={16} aria-hidden="true" /></button> : null}
    </div>
    {failed ? <>
      <p>{checkNimi ? '请检查 Nimi 中的连接和登录状态，再重试。' : '请检查伙伴的形象设置或下方技术详情，再重试。'}</p>
      <div className="zhiyu-avatar-launch-notice__actions">
        {onRetry ? <button type="button" onClick={onRetry}>重试打开</button> : null}
        <button type="button" onClick={checkNimi ? onOpenNimi : onOpenAppearance}>{checkNimi ? '检查 Nimi' : '形象设置'}</button>
      </div>
      <details><summary>技术详情</summary><p>{result.reasonCode}</p><p>{result.message}</p><p>{result.actionHint}</p></details>
    </> : null}
  </section>;
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
  const configurationError = agentConfigurationErrorMessage(chat.reasonCode);
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
        <p>{configurationError || '请重新打开会话后重试。已有消息会保留，重新打开不会自动发送。'}</p>
        {configurationError && onOpenSettings ? <button type="button" onClick={onOpenSettings}>检查伙伴模型</button> : null}
        {onReopen ? <button type="button" onClick={onReopen}>重新打开会话</button> : null}
        <details><summary>技术详情</summary><p>{chat.reasonCode}</p><p>{chat.message}</p></details>
      </div>
    </section>
  );
}
