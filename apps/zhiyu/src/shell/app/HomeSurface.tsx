import {
  Button,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import { useState } from 'react';
import type { ChatComposerAdapter } from '@nimiplatform/kit/features/chat/headless';
import {
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import {
  Image as ImageIcon,
  MessagesSquare,
  PanelRightOpen,
  Send,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import type { ZhiyuDelegationApprovalDecision, ZhiyuEvidence } from './evidence';
import type { ZhiyuCapabilityStudioCapabilityId } from '../capability-studio/zhiyu-ai-consume';
import type { ZhiyuCapabilityRoomState } from './capability-room-state';
import type { ZhiyuDiagnosticState } from './diagnostic-state';
import type {
  ZhiyuHomeGatedSurface,
  ZhiyuHomeProductState,
} from './home-product-state';
import type { ZhiyuIdentityFloorState } from './identity-floor-state';
import { CompanionStateSection } from './home-companion-state-section';
import { DelegationUxSection } from './home-delegation-ux-section';
import { DiaryReflectionSection } from './home-diary-reflection-section';
import { MemoryObservatorySection } from './home-memory-observatory-section';
import { ProposalIntakeSection } from './home-proposal-intake-section';
import {
  AvatarPresenceSection,
  CapabilityRoomSection,
  DiagnosticSurface,
  HiddenEvidenceStatus,
  IdentityFloorSection,
  StatusRow,
  formatReasonLabel,
} from './home-surface-sections';
import './home-surface.css';

type HomeSurfaceProps = {
  readonly evidence: ZhiyuEvidence;
  readonly product: ZhiyuHomeProductState;
  readonly capabilityRoom: ZhiyuCapabilityRoomState;
  readonly diagnostics: ZhiyuDiagnosticState;
  readonly identityFloor: ZhiyuIdentityFloorState;
  readonly draft: string;
  readonly capabilityPrompt: string;
  readonly imagePrompt: string;
  readonly submitEnabled: boolean;
  readonly composerState: string;
  readonly capabilityStudioDisabled: boolean;
  readonly imageStudioDisabled: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onCapabilityPromptChange: (value: string) => void;
  readonly onImagePromptChange: (value: string) => void;
  readonly onSubmit: (text: string) => Promise<void> | void;
  readonly onCapabilityStudioRun: (capabilityId: ZhiyuCapabilityStudioCapabilityId) => void;
  readonly onImageStudioRun: () => void;
  readonly onProposalSubmit: () => void;
  readonly onDelegationDecision: (
    approvalRequestId: string,
    decision: ZhiyuDelegationApprovalDecision,
  ) => void;
  readonly onOpenModelConfig: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly onAvatarManage?: () => void;
};

export function HomeSurface({
  evidence,
  product,
  capabilityRoom,
  diagnostics,
  identityFloor,
  draft,
  capabilityPrompt,
  imagePrompt,
  submitEnabled,
  composerState,
  capabilityStudioDisabled,
  imageStudioDisabled,
  onDraftChange,
  onCapabilityPromptChange,
  onImagePromptChange,
  onSubmit,
  onCapabilityStudioRun,
  onImageStudioRun,
  onProposalSubmit,
  onDelegationDecision,
  onOpenModelConfig,
  onAvatarLaunch,
  onAvatarManage,
}: HomeSurfaceProps) {
  const modelConfigLabel = routeModelBindingLabel(evidence);
  const imagePreview = imageStudioPreviewState(evidence);
  const chatComposerAdapter: ChatComposerAdapter<never> = {
    submit: async (input) => {
      await onSubmit(input.text);
    },
  };
  const chatDisabled = !evidence.conversation.ready
    || !evidence.route.executionBinding
    || evidence.chat.state === 'streaming';
  const chatRuntimeHint = chatDisabled
    ? (
      evidence.chat.state === 'streaming'
        ? '知遇正在接收 Runtime Agent 流式事件。'
        : evidence.conversation.ready
          ? evidence.route.message
          : evidence.conversation.message
    )
    : null;
  const chatFooter = evidence.chat.state === 'streaming' ? (
    <ChatStreamStatus
      mode="streaming"
      partialText={evidence.chat.latestAssistantText || '等待 Runtime Agent 输出...'}
      reasoningText={evidence.chat.reasoningText}
      reasoningLabel="Runtime reasoning"
    />
  ) : null;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const primaryMemorySurface = product.gatedSurfaces.find((surface) => surface.key === 'memory');
  const primaryAvatarSurface = product.gatedSurfaces.find((surface) => surface.key === 'avatar');
  const technicalSurfaces = product.gatedSurfaces.filter((surface) => (
    surface.key !== 'memory' && surface.key !== 'avatar'
  ));
  const renderGatedSurface = (surface: ZhiyuHomeGatedSurface) => {
    if (surface.key === 'capability') {
      return <CapabilityRoomSection key={surface.key} capabilityRoom={capabilityRoom} />;
    }
    if (surface.key === 'proposal') {
      return (
        <ProposalIntakeSection
          key={surface.key}
          surface={surface}
          proposal={evidence.proposal}
          onSubmit={onProposalSubmit}
        />
      );
    }
    if (surface.key === 'delegation') {
      return (
        <DelegationUxSection
          key={surface.key}
          surface={surface}
          delegation={evidence.delegation}
          onDecision={onDelegationDecision}
        />
      );
    }
    if (surface.key === 'identity') {
      return <IdentityFloorSection key={surface.key} surface={surface} identityFloor={identityFloor} />;
    }
    if (surface.key === 'companion') {
      return <CompanionStateSection key={surface.key} surface={surface} companion={evidence.companion} />;
    }
    if (surface.key === 'diary') {
      return <DiaryReflectionSection key={surface.key} surface={surface} diary={evidence.diaryReflection} />;
    }
    if (surface.key === 'avatar') {
      return (
        <AvatarPresenceSection
          key={surface.key}
          surface={surface}
          avatar={evidence.avatar}
          onLaunch={onAvatarLaunch}
          onManage={onAvatarManage}
        />
      );
    }
    return <MemoryObservatorySection key={surface.key} surface={surface} memory={evidence.memory} />;
  };
  return (
    <main
      className="zhiyu-home"
      data-zhiyu-screen="home"
      data-zhiyu-product-stage={product.stage}
      data-zhiyu-readiness-score={product.readinessScore}
    >
      <div
        className="zhiyu-home__workspace"
        data-zhiyu-product-shell="workspace"
        data-zhiyu-primary-ui="true"
      >
      <div className="zhiyu-home__layout zhiyu-home__shell-grid">
        <Surface
          as="section"
          className="zhiyu-home__presence"
          data-zhiyu-region="presence"
          material="solid"
          elevation="base"
          padding="md"
        >
          <div className="zhiyu-home__brand-row">
            <span className="zhiyu-home__mark" aria-hidden="true">
              <Sparkles size={18} />
            </span>
            <span className="zhiyu-home__kicker">织羽</span>
          </div>
          <h1 className="zhiyu-home__title">本地 Agent 家园</h1>
          <p className="zhiyu-home__lead">
            用户和 local agent 在这里交互、积累上下文，并随着 Runtime 投影逐步进入长期陪伴状态。
          </p>
          <div className="zhiyu-home__primary-status">
            <StatusBadge tone={product.stage === 'ready' ? 'success' : 'warning'} shape="dot">
              {product.readinessScore} ready
            </StatusBadge>
            <div>
              <h2 className="zhiyu-home__primary-title">{product.primaryTitle}</h2>
              <p className="zhiyu-home__primary-copy">{product.primaryDescription}</p>
              <p className="zhiyu-home__action-hint">{product.primaryActionHint}</p>
            </div>
          </div>
          <div className="zhiyu-home__status-grid" aria-label="织羽运行状态">
            {product.statusCards.map((card) => (
              <StatusRow key={card.key} card={card} />
            ))}
          </div>
          <Button
            type="button"
            tone="secondary"
            size="sm"
            className="zhiyu-home__diagnostics-open"
            leadingIcon={<PanelRightOpen size={15} aria-hidden="true" />}
            data-zhiyu-diagnostics-toggle="open"
            aria-expanded={diagnosticsOpen}
            aria-controls="zhiyu-diagnostics-drawer"
            onClick={() => setDiagnosticsOpen(true)}
          >
            打开诊断
          </Button>
          <HiddenEvidenceStatus evidence={evidence} />
        </Surface>

        <Surface
          as="section"
          className="zhiyu-home__conversation"
          data-zhiyu-region="conversation"
          material="glass-thin"
          elevation="base"
          padding="md"
        >
          <div className="zhiyu-home__section-heading">
            <MessagesSquare size={18} aria-hidden="true" />
            <div>
              <h2>此刻</h2>
              <p>当前输入只在 Runtime conversation anchor 和 route 都 ready 后开放。</p>
            </div>
          </div>
          <div
            className="zhiyu-home__model-config-row"
            data-zhiyu-ai-config-chip="agent-home"
            data-zhiyu-ai-config-ready={String(Boolean(evidence.route.executionBinding))}
            data-zhiyu-ai-config-enabled-capabilities={evidence.route.enabledCapabilities.join(',')}
            data-zhiyu-ai-config-binding-label={modelConfigLabel}
            data-zhiyu-ai-config-button-disabled={String(!evidence.runtime.ready)}
          >
            <Button
              type="button"
              tone="secondary"
              size="sm"
              leadingIcon={<SlidersHorizontal size={15} aria-hidden="true" />}
              disabled={!evidence.runtime.ready}
              onClick={onOpenModelConfig}
            >
              模型配置
            </Button>
            <span>{modelConfigLabel}</span>
          </div>
          <div
            className="zhiyu-home__chat-shell"
            data-zhiyu-agent-chat-state={evidence.chat.state}
            data-zhiyu-agent-chat-ready={String(evidence.chat.ready)}
            data-zhiyu-agent-chat-reason={evidence.chat.reasonCode}
            data-zhiyu-agent-chat-message-count={String(evidence.chat.messageCount)}
            data-zhiyu-agent-chat-event-types={evidence.chat.eventTypes.join(',')}
            data-zhiyu-agent-chat-request-id={evidence.chat.requestId ?? 'not_projected'}
            data-zhiyu-agent-chat-anchor-id={evidence.chat.conversationAnchorId ?? 'not_projected'}
          >
            <div className="zhiyu-home__chat-transcript">
              <CanonicalTranscriptView
                messages={evidence.chat.messages}
                activeConversationId={evidence.conversation.conversationAnchorId}
                agentName="知遇"
                emptyEyebrow="Runtime Agent Chat"
                emptyTitle="开始和知遇对话"
                emptyDescription="消息会通过 Runtime Agent conversation anchor 发送；这里只渲染 Runtime/SDK 投影，不保存本地聊天真相。"
                emptyStateVariant="compact"
                footerContent={chatFooter}
                widthClassName="w-full max-w-none"
                widthPositionClassName="mx-0"
                scrollViewportWidthClassName="w-full"
                contentPaddingBottomClassName="pb-3"
                disableRpContent
              />
            </div>
            <div
              className="zhiyu-home__composer"
              data-zhiyu-composer-state={composerState}
              data-zhiyu-submit-enabled={String(submitEnabled)}
            >
              <CanonicalComposer
                adapter={chatComposerAdapter}
                text={draft}
                onTextChange={onDraftChange}
                disabled={chatDisabled}
                placeholder="向知遇发送消息..."
                runtimeHint={chatRuntimeHint}
                modelLabel={<span>{modelConfigLabel}</span>}
                sendHint={evidence.chat.state === 'streaming' ? 'Streaming' : undefined}
                layout="stacked"
                className="zhiyu-home__canonical-composer"
              />
            </div>
          </div>
          <div
            className="zhiyu-home__legacy-composer-hidden"
            aria-hidden="true"
            data-zhiyu-legacy-composer-state={composerState}
            data-zhiyu-legacy-submit-enabled={String(submitEnabled)}
          >
            <TextareaField
              aria-label="织羽消息"
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              disabled={!evidence.conversation.ready || !evidence.route.executionBinding}
              rows={4}
              placeholder="等本地 Agent 准备好后，在这里开始第一句话。"
              textareaClassName="zhiyu-home__composer-input"
            />
            <Button
              type="submit"
              disabled={!submitEnabled}
              tone="primary"
              size="md"
              leadingIcon={<Send size={16} aria-hidden="true" />}
            >
              发送
            </Button>
          </div>
          <div className="zhiyu-home__conversation-status">
            <StatusBadge tone={evidence.conversation.ready ? 'success' : 'warning'} shape="dot">
              {formatReasonLabel(evidence.conversation.ready, evidence.conversation.reasonCode)}
            </StatusBadge>
            <StatusBadge tone={evidence.route.ready ? 'success' : 'warning'} shape="dot">
              {formatReasonLabel(evidence.route.ready, evidence.route.reasonCode)}
            </StatusBadge>
            <StatusBadge tone={evidence.chat.ready ? 'success' : evidence.chat.state === 'failed' ? 'danger' : 'warning'} shape="dot">
              {formatReasonLabel(evidence.chat.ready, evidence.chat.reasonCode)}
            </StatusBadge>
          </div>
          <p
            data-zhiyu-conversation-state={evidence.conversation.reasonCode}
            data-zhiyu-conversation-source={evidence.conversation.source}
            data-zhiyu-conversation-ready={String(evidence.conversation.ready)}
            className="zhiyu-home__evidence-line"
          >
            {evidence.conversation.message}
          </p>
          <p
            data-zhiyu-route-state={evidence.route.reasonCode}
            data-zhiyu-route-source={evidence.route.source}
            data-zhiyu-route-ready={String(evidence.route.ready)}
            className="zhiyu-home__evidence-line"
          >
            {evidence.route.message}
          </p>
          <p
            data-zhiyu-turn-state={evidence.chat.reasonCode}
            data-zhiyu-turn-source={evidence.chat.source}
            data-zhiyu-turn-ready={String(evidence.chat.ready)}
            className="zhiyu-home__evidence-line"
          >
            {evidence.chat.message}
          </p>
        </Surface>

        <Surface
          as="section"
          className="zhiyu-home__capability-studio"
          data-zhiyu-region="capability-studio"
          data-zhiyu-capability-studio={evidence.capabilityStudio.state}
          data-zhiyu-capability-studio-disabled={String(capabilityStudioDisabled)}
          data-zhiyu-capability-studio-last-capability={evidence.capabilityStudio.lastCapabilityId ?? 'none'}
          data-zhiyu-capability-studio-result-kind={evidence.capabilityStudio.resultKind}
          data-zhiyu-capability-studio-ready={String(evidence.capabilityStudio.ready)}
          material="glass-thin"
          elevation="base"
          padding="md"
        >
          <div className="zhiyu-home__section-heading">
            <Sparkles size={18} aria-hidden="true" />
            <div>
              <h2>Capability Studio</h2>
              <p>用当前模型路由运行文本生成、流式对话和嵌入能力。</p>
            </div>
          </div>
          <TextareaField
            aria-label="Capability Studio prompt"
            value={capabilityPrompt}
            onChange={(event) => onCapabilityPromptChange(event.currentTarget.value)}
            rows={3}
            placeholder="输入一段要交给 Runtime 处理的内容。"
            textareaClassName="zhiyu-home__capability-studio-input"
          />
          <div className="zhiyu-home__capability-studio-actions">
            {(['text.generate', 'chat.stream', 'text.embed'] as const).map((capabilityId) => (
              <Button
                key={capabilityId}
                type="button"
                tone="secondary"
                size="sm"
                disabled={capabilityStudioDisabled}
                data-zhiyu-capability-studio-run={capabilityId}
                onClick={() => onCapabilityStudioRun(capabilityId)}
              >
                {capabilityLabel(capabilityId)}
              </Button>
            ))}
          </div>
          <div
            className="zhiyu-home__capability-studio-result"
            data-zhiyu-capability-studio-result-kind={evidence.capabilityStudio.resultKind}
            data-zhiyu-capability-studio-result-reason={evidence.capabilityStudio.reasonCode}
            data-zhiyu-capability-studio-result-trace={evidence.capabilityStudio.traceId ?? 'not_projected'}
          >
            <StatusBadge tone={evidence.capabilityStudio.ready ? 'success' : evidence.capabilityStudio.state === 'failed' ? 'danger' : 'neutral'} shape="dot">
              {formatReasonLabel(evidence.capabilityStudio.ready, evidence.capabilityStudio.reasonCode)}
            </StatusBadge>
            <p>{formatCapabilityStudioProductText(evidence)}</p>
            {evidence.capabilityStudio.resultKind === 'embedding' ? (
              <div
                className="zhiyu-home__capability-studio-embedding"
                data-zhiyu-capability-studio-vector-count={String(evidence.capabilityStudio.vectorCount ?? 0)}
                data-zhiyu-capability-studio-dimensions={String(evidence.capabilityStudio.dimensions ?? 0)}
                data-zhiyu-capability-studio-sample={evidence.capabilityStudio.sample.join(',')}
              >
                <span>vectors {evidence.capabilityStudio.vectorCount ?? 0}</span>
                <span>dimensions {evidence.capabilityStudio.dimensions ?? 0}</span>
                <span>{evidence.capabilityStudio.sample.join(', ')}</span>
              </div>
            ) : null}
          </div>
        </Surface>

        <Surface
          as="section"
          className="zhiyu-home__image-studio"
          data-zhiyu-region="image-studio"
          data-zhiyu-image-studio={evidence.imageStudio.state}
          data-zhiyu-image-studio-disabled={String(imageStudioDisabled)}
          data-zhiyu-image-studio-ready={String(evidence.imageStudio.ready)}
          data-zhiyu-image-studio-artifact-count={String(evidence.imageStudio.artifactCount)}
          data-zhiyu-image-studio-preview-source={evidence.imageStudio.firstArtifact?.previewSource ?? 'none'}
          material="glass-thin"
          elevation="base"
          padding="md"
        >
          <div className="zhiyu-home__section-heading">
            <ImageIcon size={18} aria-hidden="true" />
            <div>
              <h2>Image Studio</h2>
              <p>通过 Runtime 场景任务生成图片，产物仍由 Runtime 管理。</p>
            </div>
          </div>
          <TextareaField
            aria-label="Image generation prompt"
            value={imagePrompt}
            onChange={(event) => onImagePromptChange(event.currentTarget.value)}
            rows={3}
            placeholder="描述要生成的图片。"
            textareaClassName="zhiyu-home__image-studio-input"
          />
          <div className="zhiyu-home__image-studio-actions">
            <Button
              type="button"
              tone="secondary"
              size="sm"
              disabled={imageStudioDisabled}
              data-zhiyu-image-generate-run="image.generate"
              onClick={onImageStudioRun}
            >
              生成图片
            </Button>
          </div>
          <div
            className="zhiyu-home__image-studio-result"
            data-zhiyu-image-generate-state={evidence.imageStudio.state}
            data-zhiyu-image-generate-reason={evidence.imageStudio.reasonCode}
            data-zhiyu-image-generate-job-id={evidence.imageStudio.jobId ?? 'not_projected'}
            data-zhiyu-image-generate-job-status={evidence.imageStudio.jobStatus ?? 'not_projected'}
            data-zhiyu-image-generate-artifact-count={String(evidence.imageStudio.artifactCount)}
            data-zhiyu-image-generate-preview-source={evidence.imageStudio.firstArtifact?.previewSource ?? 'none'}
            data-zhiyu-image-generate-preview-state={imagePreview.state}
            data-zhiyu-image-generate-trace={evidence.imageStudio.traceId ?? 'not_projected'}
          >
            <StatusBadge tone={evidence.imageStudio.ready ? 'success' : evidence.imageStudio.state === 'failed' ? 'danger' : evidence.imageStudio.state === 'running' ? 'warning' : 'neutral'} shape="dot">
              {formatReasonLabel(evidence.imageStudio.ready, evidence.imageStudio.reasonCode)}
            </StatusBadge>
            <p>{imageStudioResultText(evidence)}</p>
            <div className="zhiyu-home__image-studio-meta">
              <span>任务 {evidence.imageStudio.jobId ? '已提交' : '等待提交'}</span>
              <span>状态 {formatStudioState(evidence.imageStudio.state)}</span>
              <span>产物 {evidence.imageStudio.artifactCount}</span>
            </div>
            <div
              className="zhiyu-home__image-studio-preview-frame"
              data-zhiyu-image-generate-preview-state={imagePreview.state}
            >
              {renderableImagePreviewUrl(evidence.imageStudio.firstArtifact?.previewUrl) ? (
                <img
                  className="zhiyu-home__image-studio-preview"
                  src={evidence.imageStudio.firstArtifact?.previewUrl ?? undefined}
                  alt="Runtime generated image preview"
                  data-zhiyu-image-generate-preview="rendered"
                />
              ) : (
                <div
                  className="zhiyu-home__image-studio-empty"
                  data-zhiyu-image-generate-preview="metadata-only"
                >
                  <strong>{imagePreview.title}</strong>
                  <span>{imagePreview.description}</span>
                </div>
              )}
              <div className="zhiyu-home__image-studio-preview-caption">
                <strong>{imagePreview.title}</strong>
                <span>{imagePreview.description}</span>
              </div>
            </div>
          </div>
        </Surface>

        <div className="zhiyu-home__right-rail" aria-label="记忆和 Avatar">
          {primaryMemorySurface ? renderGatedSurface(primaryMemorySurface) : null}
          {primaryAvatarSurface ? renderGatedSurface(primaryAvatarSurface) : null}
        </div>
      </div>
      </div>
      <div
        id="zhiyu-diagnostics-drawer"
        className="zhiyu-home__diagnostics-layer"
        data-zhiyu-diagnostics-drawer={diagnosticsOpen ? 'open' : 'closed'}
        hidden={!diagnosticsOpen}
      >
        <aside
          className="zhiyu-home__diagnostics-drawer"
          role="dialog"
          aria-modal="false"
          aria-label="Runtime diagnostics"
        >
          <div className="zhiyu-home__diagnostics-header">
            <div>
              <strong>Runtime 诊断</strong>
              <span>技术投影和未开放能力保留在这里，不污染主工作区。</span>
            </div>
            <Button
              type="button"
              tone="secondary"
              size="sm"
              leadingIcon={<X size={15} aria-hidden="true" />}
              data-zhiyu-diagnostics-toggle="close"
              onClick={() => setDiagnosticsOpen(false)}
            >
              关闭
            </Button>
          </div>
          <div className="zhiyu-home__diagnostics-content">
            {technicalSurfaces.map(renderGatedSurface)}
            <DiagnosticSurface diagnostics={diagnostics} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function routeModelBindingLabel(evidence: ZhiyuEvidence): string {
  const binding = evidence.route.executionBinding;
  if (!binding) {
    return '未绑定模型';
  }
  return `${binding.route}:${binding.modelId}`;
}

function capabilityLabel(capabilityId: ZhiyuCapabilityStudioCapabilityId): string {
  if (capabilityId === 'text.generate') return '生成文本';
  if (capabilityId === 'chat.stream') return '流式对话';
  return '生成嵌入';
}

function formatCapabilityStudioProductText(evidence: ZhiyuEvidence): string {
  const studio = evidence.capabilityStudio;
  if (studio.resultKind === 'text') {
    return stripRuntimeTextEnvelope(studio.streamingText || studio.text || studio.message);
  }
  if (studio.resultKind === 'embedding') {
    return `嵌入已生成：${studio.vectorCount ?? 0} 组向量，${studio.dimensions ?? 0} 维。`;
  }
  if (studio.state === 'failed') {
    return '能力调用需要先完成模型路由配置；详细 Runtime 原因可在诊断中查看。';
  }
  if (studio.state === 'running') {
    return 'Runtime 正在处理这次能力请求。';
  }
  return '选择一个能力并输入内容后，结果会显示在这里。';
}

function stripRuntimeTextEnvelope(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  const messageMatch = text.match(/<message\b[^>]*>([\s\S]*?)<\/message>/i);
  if (messageMatch?.[1]) {
    return messageMatch[1].trim();
  }
  return text;
}

function imageStudioResultText(evidence: ZhiyuEvidence): string {
  const studio = evidence.imageStudio;
  if (studio.ready && studio.artifactCount > 0) {
    return `图片生成完成，Runtime 已返回 ${studio.artifactCount} 个产物。`;
  }
  if (studio.state === 'running') {
    return 'Runtime 正在执行图片生成任务。';
  }
  if (studio.state === 'failed') {
    return '图片生成需要先完成图片模型路由配置；详细 Runtime 原因可在诊断中查看。';
  }
  return '配置图片模型后，可以提交 Runtime image.generate 任务。';
}

type ImageStudioPreviewState = {
  readonly state: 'waiting' | 'rendered' | 'metadata-only';
  readonly title: string;
  readonly description: string;
};

function imageStudioPreviewState(evidence: ZhiyuEvidence): ImageStudioPreviewState {
  const artifact = evidence.imageStudio.firstArtifact;
  if (renderableImagePreviewUrl(artifact?.previewUrl)) {
    return {
      state: 'rendered',
      title: 'Runtime 返回了图片产物',
      description: `${artifact?.mimeType ?? 'image artifact'} · ${artifact?.previewSource ?? 'preview'}`,
    };
  }
  if (artifact) {
    return {
      state: 'metadata-only',
      title: 'Runtime 返回了图片产物',
      description: `${artifact.mimeType ?? 'image artifact'} · 当前产物只投影了元数据。`,
    };
  }
  return {
    state: 'waiting',
    title: '等待 Runtime 图片产物',
    description: '生成完成后会在这里展示 Runtime 管理的预览或产物元数据。',
  };
}

function formatStudioState(state: string): string {
  if (state === 'succeeded') return '已完成';
  if (state === 'running') return '运行中';
  if (state === 'failed') return '需要配置';
  return '待运行';
}

function renderableImagePreviewUrl(value: string | null | undefined): boolean {
  const url = String(value ?? '').trim().toLowerCase();
  return url.startsWith('data:image/')
    || url.startsWith('blob:')
    || url.startsWith('http://')
    || url.startsWith('https://');
}
