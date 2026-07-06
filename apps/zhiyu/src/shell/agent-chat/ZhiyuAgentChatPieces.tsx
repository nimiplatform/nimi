import {
  AlertTriangle,
  Headphones,
  Lightbulb,
  Mic,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { partnerInitial } from './ZhiyuAgentChatLabels';

export function BehaviorControlRow({
  label,
  detail,
  status,
  dataKey,
}: {
  readonly label: string;
  readonly detail: string;
  readonly status: string;
  readonly dataKey: string;
}) {
  return (
    <div className="zhiyu-home__behavior-control-row" data-zhiyu-agent-behavior-control={dataKey}>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <button type="button" disabled data-zhiyu-agent-behavior-control-disabled="true">
        {status}
      </button>
    </div>
  );
}

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
  hasCurrentPartner,
  avatarLaunchAction,
  onAvatarLaunch,
  onOpenSettings,
}: {
  readonly currentPartnerName: string;
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
      {partnerInitial(currentPartnerName)}
    </button>
  );
}

export function ComposerModeTools({
  evidence,
  onOpenModelConfig,
  onOpenAgentPanel,
  onOpenSettings,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly onOpenModelConfig: () => void;
  readonly onOpenAgentPanel: () => void;
  readonly onOpenSettings: () => void;
}) {
  const voiceOutputMode = evidence.companion.voiceOutputMode || '';
  const voicePlaybackState = evidence.companion.voicePlaybackState || '';
  const voiceAudioArtifactId = evidence.companion.voiceAudioArtifactId || '';
  const voicePlaybackTarget = evidence.companion.voicePlaybackTarget || '';
  const voiceStreamId = evidence.companion.voiceStreamId || '';
  const voiceProjected = voiceOutputMode.length > 0;
  const voiceState = voiceProjected ? voicePlaybackState || 'projected' : 'deferred';
  const voiceReason = voiceProjected
    ? 'zhiyu-chat-voice-runtime-projected'
    : 'zhiyu-chat-voice-runtime-surface-deferred';
  const voiceLabel = voiceProjected
    ? `语音模式：${voiceOutputMode}${voicePlaybackState ? ` / ${voicePlaybackState}` : ''}`
    : '语音模式暂未接入';
  const voiceTitle = voiceProjected
    ? `Runtime 语音投影：${voiceOutputMode}${voicePlaybackState ? ` / ${voicePlaybackState}` : ''}`
    : '语音模式暂未接入：等待 Runtime/SDK chat voice surface admission';

  return (
    <>
      <button
        type="button"
        aria-label="语音输入暂未接入"
        title="语音输入暂未接入：等待 Runtime/SDK chat voice capture surface admission"
        data-zhiyu-composer-tool="voice-capture"
        data-zhiyu-chat-voice-capture-state="deferred"
        data-zhiyu-chat-voice-capture-reason="zhiyu-chat-voice-capture-runtime-surface-deferred"
        disabled
      >
        <Mic size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label="伙伴中心" title="伙伴中心" data-zhiyu-composer-tool="agent" onClick={onOpenAgentPanel}>
        <UserRound size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={voiceLabel}
        title={voiceTitle}
        data-zhiyu-composer-tool="hands-free"
        data-zhiyu-chat-voice-state={voiceState}
        data-zhiyu-chat-voice-reason={voiceReason}
        data-zhiyu-chat-voice-output-mode={voiceOutputMode}
        data-zhiyu-chat-voice-playback-state={voicePlaybackState}
        data-zhiyu-chat-voice-audio-artifact-id={voiceAudioArtifactId}
        data-zhiyu-chat-voice-playback-target={voicePlaybackTarget}
        data-zhiyu-chat-voice-stream-id={voiceStreamId}
        disabled
      >
        <Headphones size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label="主动模式" title="主动模式" data-zhiyu-composer-tool="proactive" onClick={onOpenSettings}>
        <Lightbulb size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label="模型路线" title={`模型路线：${evidence.route.reasonCode}`} data-zhiyu-composer-tool="model" onClick={onOpenModelConfig}>
        <SlidersHorizontal size={15} aria-hidden="true" />
      </button>
    </>
  );
}

type RuntimeActionArtifactSummaryModel = {
  readonly actionEventCount: number;
  readonly artifactCount: number;
  readonly previewState: 'rendered' | 'deferred';
  readonly previewReason: string;
  readonly eventTypes: readonly string[];
  readonly artifacts: readonly RuntimeArtifactProjection[];
};

type RuntimeArtifactProjection = {
  readonly artifactId: string;
  readonly mimeType: string;
  readonly beatId: string | null;
  readonly projectionMessageId: string | null;
  readonly uri: string | null;
};

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
      aria-label="Runtime Agent chat failure"
    >
      <div className="zhiyu-home__chat-failure-mark" aria-hidden="true">
        <AlertTriangle size={17} />
      </div>
      <div className="zhiyu-home__chat-failure-copy">
        <span>回复失败</span>
        <strong>{chat.reasonCode}</strong>
        <p>{chat.message || 'Runtime Agent turn failed.'}</p>
        <small>{chat.actionHint}</small>
      </div>
    </section>
  );
}

export function RuntimeActionArtifactSummary({
  summary,
}: {
  readonly summary: RuntimeActionArtifactSummaryModel;
}) {
  return (
    <section
      className="zhiyu-home__runtime-action-artifact-summary"
      data-zhiyu-runtime-action-artifact-summary="true"
      data-zhiyu-runtime-action-count={String(summary.actionEventCount)}
      data-zhiyu-runtime-artifact-count={String(summary.artifactCount)}
      data-zhiyu-runtime-action-artifact-preview={summary.previewState}
      data-zhiyu-runtime-action-artifact-preview-reason={summary.previewReason}
      aria-label="Runtime action and artifact summary"
    >
      <div className="zhiyu-home__runtime-action-artifact-head">
        <span>Runtime actions</span>
        <strong>{summary.artifactCount > 0 ? 'Artifact projected' : 'Action projected'}</strong>
      </div>
      <div className="zhiyu-home__runtime-action-artifact-grid">
        {summary.eventTypes.map((eventType) => (
          <span
            key={eventType}
            data-zhiyu-runtime-action-artifact-event={eventType}
          >
            {runtimeActionEventLabel(eventType)}
          </span>
        ))}
        {summary.artifacts.map((artifact) => (
          <span
            key={`${artifact.artifactId}:${artifact.beatId ?? 'beat'}`}
            data-zhiyu-runtime-action-artifact-id={artifact.artifactId}
            data-zhiyu-runtime-action-artifact-mime={artifact.mimeType}
          >
            {artifact.mimeType || 'artifact'} · {artifact.artifactId}
          </span>
        ))}
      </div>
      <p>
        {summary.previewState === 'rendered'
          ? 'Image artifact preview is rendered from the Runtime artifact projection.'
          : 'Artifact preview bytes are not opened in Zhiyu until a Runtime/SDK preview URI handoff is admitted.'}
      </p>
    </section>
  );
}

export function runtimeActionArtifactSummary(
  chat: ZhiyuEvidence['chat'],
): RuntimeActionArtifactSummaryModel | null {
  const eventTypes = chat.eventTypes.filter((eventType) => isRuntimeActionArtifactEvent(eventType));
  const artifacts = runtimeArtifactsFromMessages(chat.messages);
  if (eventTypes.length === 0 && artifacts.length === 0) {
    return null;
  }
  const artifactEventCount = chat.eventTypes.filter((eventType) => eventType === 'artifact-ready').length;
  return {
    actionEventCount: eventTypes.filter((eventType) => eventType !== 'artifact-ready').length,
    artifactCount: Math.max(artifactEventCount, artifacts.length),
    previewState: artifacts.some((artifact) => isRenderableImageArtifact(artifact)) ? 'rendered' : 'deferred',
    previewReason: artifacts.some((artifact) => isRenderableImageArtifact(artifact))
      ? 'runtime-agent-turn-artifact-ready-image-rendered'
      : 'zhiyu-runtime-artifact-preview-uri-not-admitted',
    eventTypes: [...new Set(eventTypes)],
    artifacts,
  };
}

function runtimeArtifactsFromMessages(
  messages: ZhiyuEvidence['chat']['messages'],
): readonly RuntimeArtifactProjection[] {
  const artifacts: RuntimeArtifactProjection[] = [];
  for (const message of messages) {
    const rawArtifacts = message.metadata?.artifacts;
    if (!Array.isArray(rawArtifacts)) {
      continue;
    }
    for (const rawArtifact of rawArtifacts) {
      const artifact = runtimeArtifactProjection(rawArtifact);
      if (artifact) {
        artifacts.push(artifact);
      }
    }
  }
  return artifacts;
}

function runtimeArtifactProjection(value: unknown): RuntimeArtifactProjection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const artifactId = stringValue(record.artifactId);
  if (!artifactId) {
    return null;
  }
  return {
    artifactId,
    mimeType: stringValue(record.mimeType),
    beatId: stringValue(record.beatId) || null,
    projectionMessageId: stringValue(record.projectionMessageId) || null,
    uri: stringValue(record.uri) || null,
  };
}

function isRenderableImageArtifact(artifact: RuntimeArtifactProjection): boolean {
  return stringValue(artifact.uri).startsWith('data:image/')
    || (stringValue(artifact.uri).length > 0 && stringValue(artifact.mimeType).toLowerCase().startsWith('image/'));
}

function isRuntimeActionArtifactEvent(eventType: string): boolean {
  return eventType === 'beat-planned'
    || eventType === 'beat-delivery-started'
    || eventType === 'artifact-ready'
    || eventType === 'beat-delivered';
}

function runtimeActionEventLabel(eventType: string): string {
  if (eventType === 'beat-planned') {
    return 'planned';
  }
  if (eventType === 'beat-delivery-started') {
    return 'delivery started';
  }
  if (eventType === 'artifact-ready') {
    return 'artifact ready';
  }
  if (eventType === 'beat-delivered') {
    return 'delivered';
  }
  return eventType;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function RightPanelRow({
  index,
  title,
  detail,
  status,
  tone,
  onClick,
}: {
  readonly index: number;
  readonly title: string;
  readonly detail?: string | null;
  readonly status: string;
  readonly tone: 'ready' | 'attention' | 'muted';
  readonly onClick?: () => void;
}) {
  return (
    <button type="button" className="zhiyu-agent-center__panel-row" data-zhiyu-panel-row={title} onClick={onClick}>
      <span className={`zhiyu-agent-center__panel-row-index is-${tone}`}>{tone === 'ready' ? '✓' : index}</span>
      <span className="zhiyu-agent-center__panel-row-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <span className={`zhiyu-agent-center__panel-row-status is-${tone}`}>{status}</span>
    </button>
  );
}

export function KeyValue({
  label,
  value,
  badge,
}: {
  readonly label: string;
  readonly value: string | number | null | undefined;
  readonly badge?: string;
}) {
  return (
    <div className="zhiyu-agent-center__kv-row">
      <span>{label}</span>
      <strong>{String(value ?? '未投影')}</strong>
      {badge ? <em>{badge}</em> : null}
    </div>
  );
}
