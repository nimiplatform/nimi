import { useEffect, useMemo, useState } from 'react';
import {
  CANONICAL_CAPABILITY_CATALOG,
  CANONICAL_CAPABILITY_DEFERRED,
} from '@nimiplatform/kit/core/runtime-capabilities';
import type {
  RuntimeAgentConversationProjectionState,
} from '@nimiplatform/kit/features/chat/headless';
import { Runtime } from '@nimiplatform/sdk/runtime';
import {
  createInitialZhiyuEvidence,
  type ZhiyuCapabilityStudioStatus,
  type ZhiyuEvidence,
  type ZhiyuRuntimeAgentChatStatus,
} from './evidence';
import { HomeSurface } from './HomeSurface';
import { projectZhiyuCapabilityRoomState } from './capability-room-state';
import { projectZhiyuDiagnosticState } from './diagnostic-state';
import { projectZhiyuHomeProductState } from './home-product-state';
import { projectZhiyuIdentitySafetyEvidence } from './identity-safety-evidence';
import { projectZhiyuIdentityFloorState } from './identity-floor-state';
import { projectZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { probeZhiyuAvatarPresence } from '../avatar/avatar-presence';
import {
  runZhiyuCapabilityStudioAIConsume,
  type ZhiyuCapabilityStudioCapabilityId,
} from '../capability-studio/zhiyu-ai-consume';
import { ZhiyuAiConfigSettings } from '../ai-config/zhiyu-ai-config-settings';
import {
  createZhiyuAgentHomeAIScopeRef,
  createZhiyuAIConfigService,
} from '../ai-config/zhiyu-ai-config-store';
import { createZhiyuRuntimeModelPickerProviderCache } from '../ai-config/zhiyu-runtime-model-provider';
import { probeZhiyuRuntimeAgentInventory } from '../agent/agent-inventory';
import { probeZhiyuRuntimeCompanionState } from '../agent/companion-state';
import { probeZhiyuRuntimeConversationHome } from '../agent/conversation-home';
import {
  probeZhiyuRuntimeDelegationUx,
  submitZhiyuRuntimeDelegationApproval,
} from '../agent/delegation-ux';
import { projectZhiyuDiaryReflectionArtifacts } from '../agent/diary-reflection';
import { probeZhiyuLocalAgentDiscovery } from '../agent/local-agent-discovery';
import { resolveZhiyuRuntimeLocalAgentSelection } from '../agent/local-agent-selection';
import { probeZhiyuRuntimeMemoryObservatory } from '../agent/memory-observatory';
import {
  projectZhiyuProposalIntakeStatus,
  submitZhiyuCapabilityProposal,
} from '../agent/proposal-intake';
import { probeZhiyuRuntimeRouteProjection } from '../agent/route-projection';
import { probeZhiyuRuntimeSourceProjection } from '../agent/source-projection';
import {
  probeZhiyuRuntimeTurnReadiness,
} from '../agent/turn-readiness';
import { runZhiyuRuntimeAgentChatTurn } from '../agent/runtime-agent-chat';
import { withZhiyuElectronRuntimeProtectedScopes } from '../agent/runtime-agent-scopes';
import { probeZhiyuRuntimeAccountStatus } from '../auth/runtime-account-status';
import { probeZhiyuRuntimeStatus } from '../runtime/runtime-status';

export function App() {
  const aiConfigScopeRef = useMemo(() => createZhiyuAgentHomeAIScopeRef(), []);
  const aiConfigService = useMemo(() => createZhiyuAIConfigService(), []);
  const modelPickerProviderResolver = useMemo(() => createZhiyuRuntimeModelPickerProviderCache(), []);
  const [aiConfig, setAiConfig] = useState(() => aiConfigService.aiConfig.get(aiConfigScopeRef));
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [evidence, setEvidence] = useState<ZhiyuEvidence>(() => createInitialZhiyuEvidence());
  const [draft, setDraft] = useState('');
  const [capabilityPrompt, setCapabilityPrompt] = useState('');
  const renderEvidence = useMemo(() => projectZhiyuIdentitySafetyEvidence(evidence), [evidence]);

  useEffect(() => {
    setAiConfig(aiConfigService.aiConfig.get(aiConfigScopeRef));
    return aiConfigService.aiConfig.subscribe(aiConfigScopeRef, setAiConfig);
  }, [aiConfigScopeRef, aiConfigService]);

  useEffect(() => {
    window.__nimiZhiyuEvidence = renderEvidence;
  }, [renderEvidence]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [runtime, auth, source] = await Promise.all([
        probeZhiyuRuntimeStatus(),
        probeZhiyuRuntimeAccountStatus(),
        probeZhiyuRuntimeSourceProjection(),
      ]);
      const inventory = await probeZhiyuRuntimeAgentInventory(auth);
      const sourceLocalAgent = await probeZhiyuLocalAgentDiscovery(source.ready ? {
        ownerUserId: source.ownerUserId,
        runtimeSourceRef: source.runtimeSourceRef,
        sourceRef: source.sourceRef,
      } : {});
      const localAgent = resolveZhiyuRuntimeLocalAgentSelection({
        sourceLocalAgent,
        inventory,
      });
      const diaryReflection = projectZhiyuDiaryReflectionArtifacts(localAgent);
      const [conversation, memory, route, companion, avatar] = await Promise.all([
        probeZhiyuRuntimeConversationHome(localAgent),
        probeZhiyuRuntimeMemoryObservatory(localAgent),
        probeZhiyuRuntimeRouteProjection({ config: aiConfig }),
        probeZhiyuRuntimeCompanionState(localAgent),
        probeZhiyuAvatarPresence(localAgent),
      ]);
      const delegation = await probeZhiyuRuntimeDelegationUx(conversation);
      const proposal = projectZhiyuProposalIntakeStatus({ conversation });
      const turn = probeZhiyuRuntimeTurnReadiness(conversation, route.executionBinding);
      if (!active) {
        return;
      }
      setEvidence((current) => ({
        ...current,
        runtime,
        auth,
        source,
        inventory,
        localAgent,
        conversation,
        memory,
        companion,
        diaryReflection,
        delegation,
        proposal,
        avatar,
        route,
        turn,
      }));
    })();
    return () => {
      active = false;
    };
  }, [aiConfig]);

  const product = useMemo(() => projectZhiyuHomeProductState(renderEvidence), [renderEvidence]);
  const capabilityRoom = useMemo(() => projectZhiyuCapabilityRoomState({
    evidence: renderEvidence,
    catalog: CANONICAL_CAPABILITY_CATALOG,
    deferred: CANONICAL_CAPABILITY_DEFERRED,
  }), [renderEvidence]);
  const diagnostics = useMemo(() => projectZhiyuDiagnosticState(renderEvidence), [renderEvidence]);
  const identityFloor = useMemo(() => projectZhiyuIdentityFloorState(renderEvidence), [renderEvidence]);
  const avatarLaunchAction = useMemo(() => projectZhiyuAvatarLaunchAction(renderEvidence), [renderEvidence]);

  const submitEnabled = renderEvidence.conversation.ready
    && Boolean(renderEvidence.route.executionBinding)
    && renderEvidence.chat.state !== 'streaming'
    && renderEvidence.composer.submitState !== 'submitting'
    && draft.trim().length > 0;
  const composerState = evidence.chat.state === 'streaming' || evidence.composer.submitState === 'submitting'
    ? 'submitting'
    : submitEnabled
      ? 'ready'
      : 'blocked';
  const capabilityStudioDisabled = !renderEvidence.runtime.ready
    || !renderEvidence.auth.ready
    || !capabilityPrompt.trim()
    || renderEvidence.capabilityStudio.state === 'running';

  async function handleSubmit(textInput: string) {
    const text = textInput.trim();
    setEvidence((current) => ({
      ...current,
      composer: {
        ...current.composer,
        submitState: 'submitting',
        draftLength: text.trim().length,
        reasonCode: 'zhiyu-runtime-turn-submitting',
        actionHint: 'wait_runtime_agent_turn_stream',
        source: 'renderer',
        message: 'Runtime Agent chat turn is being submitted.',
      },
      chat: {
        ...current.chat,
        ready: false,
        state: 'streaming',
        reasonCode: 'runtime-agent-chat-submitting',
        actionHint: 'wait_runtime_agent_turn_stream',
        source: 'renderer',
        message: 'Runtime Agent chat turn is being submitted.',
      },
    }));
    const submitted = await runZhiyuRuntimeAgentChatTurn({
      conversation: evidence.conversation,
      route: evidence.route,
      text,
      expectedConversationAnchorId: evidence.conversation.conversationAnchorId,
      onEvent: (_event, projection) => {
        setEvidence((current) => {
          const chat = chatStatusFromProjection(projection);
          return {
            ...current,
            chat,
            turn: turnStatusFromChat(chat),
            composer: {
              ...current.composer,
              submitState: chat.state === 'streaming' ? 'submitting' : chat.ready ? 'accepted' : 'failed',
              draftLength: text.length,
              reasonCode: chat.reasonCode,
              actionHint: chat.actionHint,
              source: chat.source,
              message: chat.message,
            },
          };
        });
      },
    });
    const chat = chatStatusFromResult(submitted);
    setEvidence((current) => ({
      ...current,
      chat,
      turn: turnStatusFromChat(chat),
      composer: {
        ...current.composer,
        submitState: submitted.ready ? 'accepted' : 'failed',
        draftLength: text.trim().length,
        reasonCode: chat.reasonCode,
        actionHint: chat.actionHint,
        source: chat.source,
        message: chat.message,
      },
    }));
    if (submitted.ready) {
      setDraft('');
    }
  }

  async function handleDelegationDecision(
    approvalRequestId: string,
    decision: 'approve' | 'reject',
  ) {
    const delegation = await submitZhiyuRuntimeDelegationApproval({
      conversation: evidence.conversation,
      approvalRequestId,
      decision,
    });
    setEvidence((current) => ({
      ...current,
      delegation,
    }));
  }

  async function handleProposalSubmit() {
    const proposal = await submitZhiyuCapabilityProposal({
      conversation: evidence.conversation,
    });
    setEvidence((current) => ({
      ...current,
      proposal,
    }));
  }

  async function handleCapabilityStudioRun(capabilityId: ZhiyuCapabilityStudioCapabilityId) {
    const prompt = capabilityPrompt.trim();
    if (!prompt) {
      setEvidence((current) => ({
        ...current,
        capabilityStudio: capabilityStudioUnavailable({
          capabilityId,
          reasonCode: 'zhiyu-capability-studio-prompt-required',
          actionHint: 'enter_capability_studio_prompt',
          message: 'Capability Studio prompt is required before dispatch.',
        }),
      }));
      return;
    }
    setEvidence((current) => ({
      ...current,
      capabilityStudio: {
        ...current.capabilityStudio,
        ready: false,
        state: 'running',
        reasonCode: 'zhiyu-capability-studio-running',
        actionHint: 'wait_runtime_ai_consume_result',
        source: 'renderer',
        message: `Running ${capabilityId} through Runtime.`,
        lastCapabilityId: capabilityId,
        resultKind: 'none',
        text: null,
        streamingText: capabilityId === 'chat.stream' ? '' : null,
        finishReason: null,
        vectorCount: null,
        dimensions: null,
        sample: [],
        audioJobId: null,
        audioJobStatus: null,
        audioArtifactCount: null,
        audioMimeType: null,
        audioPreviewUrl: null,
        traceId: null,
      },
    }));
    const runtime = new Runtime({
      appId: 'nimi.zhiyu',
      transport: { type: 'electron-ipc' },
    });
    const result = await runZhiyuCapabilityStudioAIConsume({
      runtime,
      config: aiConfig,
      capabilityId,
      prompt,
      subjectUserId: renderEvidence.auth.accountId ?? undefined,
      withScopes: withZhiyuElectronRuntimeProtectedScopes,
      onPartial: (streamingText) => {
        setEvidence((current) => ({
          ...current,
          capabilityStudio: {
            ...current.capabilityStudio,
            streamingText,
            text: streamingText,
            resultKind: 'text',
            message: streamingText,
          },
        }));
      },
    });
    setEvidence((current) => ({
      ...current,
      capabilityStudio: capabilityStudioFromResult(capabilityId, result),
    }));
  }

  return (
    <>
    <HomeSurface
      evidence={renderEvidence}
      product={product}
      capabilityRoom={capabilityRoom}
      diagnostics={diagnostics}
      identityFloor={identityFloor}
      draft={draft}
      capabilityPrompt={capabilityPrompt}
      submitEnabled={submitEnabled}
      composerState={composerState}
      capabilityStudioDisabled={capabilityStudioDisabled}
      avatarLaunchAction={avatarLaunchAction}
      onDraftChange={setDraft}
      onCapabilityPromptChange={setCapabilityPrompt}
      onSubmit={handleSubmit}
      onCapabilityStudioRun={(capabilityId) => {
        void handleCapabilityStudioRun(capabilityId);
      }}
      onProposalSubmit={() => {
        void handleProposalSubmit();
      }}
      onDelegationDecision={(approvalRequestId, decision) => {
        void handleDelegationDecision(approvalRequestId, decision);
      }}
      onOpenModelConfig={() => setAiConfigOpen(true)}
      onAvatarLaunch={() => {
        setEvidence((current) => ({
          ...current,
          avatar: {
            ...current.avatar,
            reasonCode: 'zhiyu-avatar-public-handoff-not-admitted',
            actionHint: 'admit_public_avatar_handoff',
            message: avatarLaunchAction.message,
          },
        }));
      }}
    />
    {aiConfigOpen ? (
      <ZhiyuAiConfigSettings
        scopeRef={aiConfigScopeRef}
        service={aiConfigService}
        providerResolver={modelPickerProviderResolver}
        runtimeReady={renderEvidence.runtime.ready}
        runtimeDetail={renderEvidence.runtime.ready ? null : renderEvidence.runtime.message}
        onClose={() => setAiConfigOpen(false)}
      />
    ) : null}
    </>
  );
}

function capabilityStudioFromResult(
  capabilityId: ZhiyuCapabilityStudioCapabilityId,
  result: Awaited<ReturnType<typeof runZhiyuCapabilityStudioAIConsume>>,
): ZhiyuCapabilityStudioStatus {
  if (result.ok === false) {
    return capabilityStudioUnavailable({
      capabilityId,
      reasonCode: result.reason,
      actionHint: 'inspect_runtime_ai_consume_failure',
      message: result.message,
    });
  }
  if (result.output.kind === 'embedding') {
    return {
      transport: 'electron-ipc',
      ready: true,
      state: 'succeeded',
      reasonCode: 'zhiyu-capability-studio-embedding-ready',
      actionHint: 'review_embedding_summary',
      source: 'runtime',
      message: result.message,
      lastCapabilityId: capabilityId,
      resultKind: 'embedding',
      text: null,
      streamingText: null,
      finishReason: null,
      vectorCount: result.output.vectorCount,
      dimensions: result.output.dimensions,
      sample: result.output.sample,
      audioJobId: null,
      audioJobStatus: null,
      audioArtifactCount: null,
      audioMimeType: null,
      audioPreviewUrl: null,
      traceId: result.trace?.traceId ?? null,
    };
  }
  if (result.output.kind === 'audio-artifacts') {
    return {
      transport: 'electron-ipc',
      ready: true,
      state: 'succeeded',
      reasonCode: 'zhiyu-capability-studio-audio-ready',
      actionHint: 'review_runtime_audio_artifacts',
      source: 'runtime',
      message: result.message,
      lastCapabilityId: capabilityId,
      resultKind: 'audio',
      text: null,
      streamingText: null,
      finishReason: null,
      vectorCount: null,
      dimensions: null,
      sample: [],
      audioJobId: result.output.jobId,
      audioJobStatus: result.output.jobStatus,
      audioArtifactCount: result.output.artifactCount,
      audioMimeType: result.output.firstArtifact?.mimeType ?? null,
      audioPreviewUrl: result.output.firstArtifact?.previewUrl ?? null,
      traceId: result.trace?.traceId ?? null,
    };
  }
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'succeeded',
    reasonCode: result.output.streamed
      ? 'zhiyu-capability-studio-stream-ready'
      : 'zhiyu-capability-studio-text-ready',
    actionHint: 'review_runtime_ai_text_result',
    source: 'runtime',
    message: result.message,
    lastCapabilityId: capabilityId,
    resultKind: 'text',
    text: result.output.text,
    streamingText: result.output.streamed ? result.output.text : null,
    finishReason: result.output.finishReason,
    vectorCount: null,
    dimensions: null,
    sample: [],
    audioJobId: null,
    audioJobStatus: null,
    audioArtifactCount: null,
    audioMimeType: null,
    audioPreviewUrl: null,
    traceId: result.trace?.traceId ?? null,
  };
}

function chatStatusFromProjection(
  projection: RuntimeAgentConversationProjectionState,
): ZhiyuRuntimeAgentChatStatus {
  const latestAssistant = latestAssistantMessage(projection.messages);
  return {
    transport: 'electron-ipc',
    ready: projection.status === 'completed',
    state: projection.status,
    reasonCode: projection.reasonCode,
    actionHint: projection.status === 'completed'
      ? 'review_runtime_agent_chat_message'
      : 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: projection.message,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: projection.localAgentRef,
    conversationAnchorId: projection.conversationAnchorId,
    requestId: projection.turnId,
    eventTypes: projection.events.map((event) => event.type),
    messageCount: projection.messages.length,
    messages: projection.messages,
    latestAssistantText: latestAssistant?.text || null,
    reasoningText: projection.reasoningText || null,
    outputText: projection.outputText || null,
    diagnostics: projection.diagnostics,
  };
}

function chatStatusFromResult(
  result: Awaited<ReturnType<typeof runZhiyuRuntimeAgentChatTurn>>,
): ZhiyuRuntimeAgentChatStatus {
  const latestAssistant = latestAssistantMessage(result.messages);
  return {
    transport: 'electron-ipc',
    ready: result.ready,
    state: result.state,
    reasonCode: result.reasonCode,
    actionHint: result.actionHint,
    source: result.source,
    message: result.message,
    ownerUserId: result.ownerUserId,
    runtimeSourceRef: result.runtimeSourceRef,
    localAgentRef: result.localAgentRef,
    conversationAnchorId: result.conversationAnchorId,
    requestId: result.requestId,
    eventTypes: result.events.map((event) => event.type),
    messageCount: result.messages.length,
    messages: result.messages,
    latestAssistantText: latestAssistant?.text || result.outputText,
    reasoningText: result.reasoningText,
    outputText: result.outputText,
    diagnostics: result.diagnostics,
  };
}

function turnStatusFromChat(chat: ZhiyuRuntimeAgentChatStatus): ZhiyuEvidence['turn'] {
  const latestAssistant = latestAssistantMessage(chat.messages);
  return {
    transport: 'electron-ipc',
    ready: chat.ready,
    reasonCode: chat.reasonCode,
    actionHint: chat.actionHint,
    source: chat.source,
    message: chat.message,
    ownerUserId: chat.ownerUserId,
    runtimeSourceRef: chat.runtimeSourceRef,
    localAgentRef: chat.localAgentRef,
    conversationAnchorId: chat.conversationAnchorId,
    requestId: chat.requestId,
    messageId: latestAssistant?.id ?? null,
  };
}

function latestAssistantMessage(
  messages: RuntimeAgentConversationProjectionState['messages'],
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (message.role === 'agent' || message.role === 'assistant')) {
      return message;
    }
  }
  return null;
}

function capabilityStudioUnavailable(input: {
  readonly capabilityId: ZhiyuCapabilityStudioCapabilityId;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly message: string;
}): ZhiyuCapabilityStudioStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'failed',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'runtime',
    message: input.message,
    lastCapabilityId: input.capabilityId,
    resultKind: 'unavailable',
    text: null,
    streamingText: null,
    finishReason: null,
    vectorCount: null,
    dimensions: null,
    sample: [],
    audioJobId: null,
    audioJobStatus: null,
    audioArtifactCount: null,
    audioMimeType: null,
    audioPreviewUrl: null,
    traceId: null,
  };
}
