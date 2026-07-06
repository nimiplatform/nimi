import {
  Button,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  AudioLines,
  Sparkles,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuCapabilityStudioCapabilityId } from '../app/developer-capability-studio';
import type { ZhiyuCapabilityRoomState } from '../app/capability-room-state';
import { formatProjectionValue } from '../app/home-surface-sections';
import { AgentCenterCapabilitySetupSection } from './AgentCenterCapabilitySetupSection';

export type AgentCenterCapabilityProbePanelProps = {
  readonly evidence: ZhiyuEvidence;
  readonly capabilityRoom: ZhiyuCapabilityRoomState;
  readonly capabilityPrompt: string;
  readonly capabilityStudioDisabled: boolean;
  readonly showCapabilityStudio: boolean;
  readonly hasCurrentPartner: boolean;
  readonly onCapabilityPromptChange: (value: string) => void;
  readonly onCapabilityStudioRun: (capabilityId: ZhiyuCapabilityStudioCapabilityId) => void;
  readonly onOpenModelConfig: () => void;
  readonly onSelectPartner: () => void;
};

const CAPABILITY_ACTIONS = [
  'text.generate',
  'chat.stream',
  'text.embed',
  'audio.synthesize',
] as const;

export function AgentCenterCapabilityProbePanel({
  evidence,
  capabilityRoom,
  capabilityPrompt,
  capabilityStudioDisabled,
  showCapabilityStudio,
  hasCurrentPartner,
  onCapabilityPromptChange,
  onCapabilityStudioRun,
  onOpenModelConfig,
  onSelectPartner,
}: AgentCenterCapabilityProbePanelProps) {
  return (
    <div
      className="zhiyu-agent-center__capability-probe"
      data-zhiyu-agent-center-capability-probe="open"
      data-zhiyu-devmode-ai-consume="kit-generation"
      data-zhiyu-devmode-audio-synthesize="kit-generation"
    >
      <Surface
        as="section"
        className="zhiyu-agent-center__capability-overview"
        data-zhiyu-region="agent-center-capability-probe"
        material="glass-thin"
        elevation="base"
        padding="md"
      >
        <div className="zhiyu-agent-center__section-heading">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <h2>开发者后台</h2>
            <p>能力消费、链路状态和失败原因保留在这里；主界面只呈现伙伴体验。</p>
          </div>
        </div>
        <div className="zhiyu-agent-center__capability-route-grid" aria-label="能力探针链路摘要">
          <span>伙伴：{formatProjectionValue(evidence.localAgent.localAgentRef)}</span>
          <span>对话：{formatProjectionValue(evidence.conversation.conversationAnchorId)}</span>
          <span>文字：{formatProjectionValue(executionCapabilitySummary(evidence, 'text.generate'))}</span>
          <span>图片：{formatProjectionValue(executionCapabilitySummary(evidence, 'image.generate'))}</span>
          <span>配置版本：{formatProjectionValue(evidence.route.configRevision === null ? null : String(evidence.route.configRevision))}</span>
          <span>{capabilityRoom.catalogCount} 项能力目录</span>
        </div>
      </Surface>

      {showCapabilityStudio ? (
        <Surface
          as="section"
          className="zhiyu-agent-center__capability-studio"
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
          <div className="zhiyu-agent-center__section-heading">
            <Sparkles size={18} aria-hidden="true" />
            <div>
              <h2>能力探针</h2>
              <p>通过 Kit generation 共享 helper 验证文字、嵌入、流式回复和语音合成。</p>
            </div>
          </div>
          <TextareaField
            aria-label="能力探针输入"
            value={capabilityPrompt}
            onChange={(event) => onCapabilityPromptChange(event.currentTarget.value)}
            rows={3}
            placeholder="输入一段用于开发者后台验证的内容。"
            textareaClassName="zhiyu-agent-center__capability-studio-input"
          />
          <div className="zhiyu-agent-center__capability-studio-actions">
            {CAPABILITY_ACTIONS.map((capabilityId) => (
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
            className="zhiyu-agent-center__capability-studio-result"
            data-zhiyu-capability-studio-result-kind={evidence.capabilityStudio.resultKind}
            data-zhiyu-capability-studio-result-reason={evidence.capabilityStudio.reasonCode}
            data-zhiyu-capability-studio-result-trace={evidence.capabilityStudio.traceId ?? 'not_projected'}
          >
            <StatusBadge tone={evidence.capabilityStudio.ready ? 'success' : evidence.capabilityStudio.state === 'failed' ? 'danger' : 'neutral'} shape="dot">
              {capabilityStudioStatusLabel(evidence, capabilityPrompt)}
            </StatusBadge>
            <p>{formatCapabilityStudioProductText(evidence)}</p>
            {evidence.capabilityStudio.resultKind === 'embedding' ? (
              <div
                className="zhiyu-agent-center__capability-studio-embedding"
                data-zhiyu-capability-studio-vector-count={String(evidence.capabilityStudio.vectorCount ?? 0)}
                data-zhiyu-capability-studio-dimensions={String(evidence.capabilityStudio.dimensions ?? 0)}
                data-zhiyu-capability-studio-sample={evidence.capabilityStudio.sample.join(',')}
              >
                <span>向量组 {evidence.capabilityStudio.vectorCount ?? 0}</span>
                <span>维度 {evidence.capabilityStudio.dimensions ?? 0}</span>
                <span>样本 {evidence.capabilityStudio.sample.join(', ')}</span>
              </div>
            ) : null}
            {evidence.capabilityStudio.resultKind === 'audio' ? (
              <div
                className="zhiyu-agent-center__capability-studio-audio"
                data-zhiyu-capability-studio-audio-job-id={evidence.capabilityStudio.audioJobId ?? 'not_projected'}
                data-zhiyu-capability-studio-audio-artifact-count={String(evidence.capabilityStudio.audioArtifactCount ?? 0)}
                data-zhiyu-capability-studio-audio-mime={evidence.capabilityStudio.audioMimeType ?? 'not_projected'}
              >
                <AudioLines size={16} aria-hidden="true" />
                <span>{evidence.capabilityStudio.audioArtifactCount ?? 0} 个音频产物</span>
                <span>{formatProjectionValue(evidence.capabilityStudio.audioMimeType)}</span>
              </div>
            ) : null}
          </div>
        </Surface>
      ) : (
        <AgentCenterCapabilitySetupSection
          hasCurrentPartner={hasCurrentPartner}
          onConfigureModel={onOpenModelConfig}
          onSelectPartner={onSelectPartner}
        />
      )}

    </div>
  );
}

function executionCapabilitySummary(evidence: ZhiyuEvidence, capability: string): string | null {
  const projection = evidence.route.capabilities[capability];
  if (!projection) {
    return null;
  }
  const bindingLabel = projection.binding
    ? `${projection.binding.route === 'local' ? '本地' : '云端'} ${projection.binding.modelId}`
    : '未绑定';
  return `${bindingLabel} · ${projection.state}`;
}

function capabilityLabel(capabilityId: ZhiyuCapabilityStudioCapabilityId): string {
  if (capabilityId === 'text.generate') return '生成文本';
  if (capabilityId === 'chat.stream') return '流式对话';
  if (capabilityId === 'text.embed') return '生成嵌入';
  return '语音合成';
}

function capabilityStudioStatusLabel(evidence: ZhiyuEvidence, capabilityPrompt: string): string {
  const studio = evidence.capabilityStudio;
  if (studio.ready) {
    return '已完成';
  }
  if (studio.state === 'running') {
    return '处理中';
  }
  if (studio.state === 'failed') {
    return '需要处理';
  }
  return capabilityPrompt.trim() ? '待开始' : '等待输入';
}

function formatCapabilityStudioProductText(evidence: ZhiyuEvidence): string {
  const studio = evidence.capabilityStudio;
  if (studio.resultKind === 'text') {
    return runtimeTextForDisplay(stripRuntimeTextEnvelope(studio.streamingText || studio.text || studio.message));
  }
  if (studio.resultKind === 'embedding') {
    return `嵌入已生成：${studio.vectorCount ?? 0} 组向量，${studio.dimensions ?? 0} 维。`;
  }
  if (studio.resultKind === 'audio') {
    return `语音合成已完成：${studio.audioArtifactCount ?? 0} 个音频产物。`;
  }
  if (studio.state === 'failed') {
    return '能力探针需要先完成模型配置；详细原因可在诊断中查看。';
  }
  if (studio.state === 'running') {
    return '正在处理这次能力请求。';
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

function runtimeTextForDisplay(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  return text;
}
