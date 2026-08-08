import {
  AlertTriangle,
  Lightbulb,
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
  avatarLaunchAction,
  onAvatarLaunch,
  onOpenSettings,
}: {
  readonly currentPartnerName: string;
  readonly currentPartnerAvatarUrl: string | null;
  readonly hasCurrentPartner: boolean;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly onAvatarLaunch?: () => void;
  readonly onOpenSettings: () => void;
}) {
  return (
    <button
      type="button"
      className="zhiyu-home__composer-avatar"
      aria-label={hasCurrentPartner ? `形象：${currentPartnerName}` : '选择本地伙伴'}
      data-zhiyu-avatar-launch-entry={avatarLaunchAction.state}
      data-zhiyu-avatar-launch-reason={avatarLaunchAction.reasonCode}
      onClick={() => {
        if (avatarLaunchAction.state === 'ready' && onAvatarLaunch) {
          onAvatarLaunch();
          return;
        }
        onOpenSettings();
      }}
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
  onOpenAgentPanel,
  onOpenSettings,
}: {
  readonly onOpenAgentPanel: () => void;
  readonly onOpenSettings: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="伙伴中心"
        title="伙伴中心"
        data-nimi-semantic-id="zhiyu-primary-action"
        data-zhiyu-composer-tool="agent"
        onClick={onOpenAgentPanel}
      >
        <UserRound size={16} aria-hidden="true" />
      </button>
      <button type="button" aria-label="主动模式" title="主动模式" data-zhiyu-composer-tool="proactive" onClick={onOpenSettings}>
        <Lightbulb size={16} aria-hidden="true" />
      </button>
    </>
  );
}

export function RuntimeChatFailureNotice({
  chat,
}: {
  readonly chat: ZhiyuEvidence['chat'];
}) {
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
        <p>请稍后重试；如果问题持续，请打开诊断查看详情。</p>
      </div>
    </section>
  );
}
