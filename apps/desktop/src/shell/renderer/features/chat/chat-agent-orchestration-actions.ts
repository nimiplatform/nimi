import type {
  ConversationTurnEvent,
} from '@nimiplatform/nimi-kit/features/chat';
import { feedStreamEvent } from '../turns/stream-controller';
import { toChatAgentRuntimeError } from './chat-agent-runtime';
import type {
  AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';
import type { AgentModelOutputDiagnostics } from './chat-agent-behavior-resolver';
import {
  findSingleExecutableFollowUpAction,
  findSingleExecutableImageAction,
  findSingleExecutableVoiceAction,
  resolveImageStateFromResolvedAction,
  resolveVoiceStateFromResolvedAction,
  type AgentLocalChatImageState,
  type AgentLocalChatVoiceState,
} from './chat-agent-turn-plan';
import {
  buildVoiceWorkflowMetadata,
  createAgentTailAbortSignal,
  mergeAgentImageDiagnostics,
  resolveVoiceWorkflowProgressMessage,
} from './chat-agent-orchestration-shared';
import type {
  AgentLocalChatProviderMetadata,
  AgentLocalChatRuntimeAdapter,
} from './chat-agent-orchestration';

export async function runResolvedEnvelopeActions(input: {
  threadId: string;
  turnId: string;
  signal: AbortSignal | undefined;
  metadata: AgentLocalChatProviderMetadata;
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  envelope: AgentResolvedMessageActionEnvelope;
  outputDiagnostics: AgentModelOutputDiagnostics | null;
  onEvent: (event: ConversationTurnEvent) => Promise<void> | void;
}): Promise<{
  imageState: AgentLocalChatImageState;
  voiceState: AgentLocalChatVoiceState;
  outputDiagnostics: AgentModelOutputDiagnostics | null;
  followUpAction: AgentResolvedMessageActionEnvelope['actions'][number] | null;
}> {
  let voiceState: AgentLocalChatVoiceState = { status: 'none' };
  let imageState: AgentLocalChatImageState = { status: 'none' };
  let outputDiagnostics = input.outputDiagnostics;
  const followUpAction = findSingleExecutableFollowUpAction(input.envelope);
  const voiceAction = findSingleExecutableVoiceAction(input.envelope);
  const voiceDecision = voiceAction
    ? resolveVoiceStateFromResolvedAction({
      turnId: input.turnId,
      action: voiceAction,
      textMessageCount: 1,
      transcriptText: input.envelope.message.text,
      agentResolution: input.metadata.agentResolution,
      voiceExecutionSnapshot: input.metadata.voiceExecutionSnapshot,
      voiceWorkflowExecutionSnapshotByCapability: input.metadata.voiceWorkflowExecutionSnapshotByCapability,
    })
    : { status: 'none' as const };
  const imageAction = findSingleExecutableImageAction(input.envelope);
  const imageDecision = imageAction
    ? resolveImageStateFromResolvedAction({
      turnId: input.turnId,
      action: imageAction,
      textMessageCount: 1,
      agentResolution: input.metadata.agentResolution,
      imageExecutionSnapshot: input.metadata.imageExecutionSnapshot,
    })
    : { status: 'none' as const };
  const actionExecutions = [
    ...(voiceDecision.status === 'none'
      ? []
      : [{
        beatId: voiceDecision.beatId,
        beatIndex: voiceDecision.beatIndex,
        modality: 'voice' as const,
        run: async () => {
          if (voiceDecision.status === 'pending') {
            try {
              const submittedWorkflow = await input.runtimeAdapter.submitVoiceWorkflow({
                threadId: input.threadId,
                turnId: input.turnId,
                beatId: voiceDecision.beatId,
                workflowIntent: voiceDecision.workflowIntent,
                prompt: voiceDecision.prompt,
                voiceWorkflowExecutionSnapshot: input.metadata.voiceWorkflowExecutionSnapshotByCapability[
                  voiceDecision.workflowIntent.capability
                ] || null,
                referenceAudio: voiceDecision.workflowIntent.workflowType === 'tts_v2v'
                  ? input.metadata.latestVoiceCapture
                  : null,
                signal: createAgentTailAbortSignal(input.threadId, input.signal),
              });
              const progressMessage = resolveVoiceWorkflowProgressMessage(
                voiceDecision.workflowIntent.workflowType,
              );
              const workflowMetadata = buildVoiceWorkflowMetadata({
                turnId: input.turnId,
                voiceDecision,
                workflowStatus: submittedWorkflow.workflowStatus,
                jobId: submittedWorkflow.jobId,
                traceId: submittedWorkflow.traceId,
                voiceReference: submittedWorkflow.voiceReference,
                voiceAssetId: submittedWorkflow.voiceAssetId,
                providerVoiceRef: submittedWorkflow.providerVoiceRef,
                message: progressMessage,
              });
              voiceState = {
                ...voiceDecision,
                message: progressMessage,
                metadata: workflowMetadata,
              };
            } catch (voiceError) {
              voiceState = {
                status: 'error',
                beatId: voiceDecision.beatId,
                beatIndex: voiceDecision.beatIndex,
                projectionMessageId: voiceDecision.projectionMessageId,
                prompt: voiceDecision.prompt,
                transcriptText: voiceDecision.transcriptText,
                sourceMessageId: voiceDecision.sourceMessageId,
                sourceActionId: voiceDecision.sourceActionId,
                workflowIntent: voiceDecision.workflowIntent,
                message: toChatAgentRuntimeError(voiceError).message,
              };
            }
            return;
          }
          if (voiceDecision.status !== 'synthesize') {
            voiceState = voiceDecision;
            return;
          }
          await input.onEvent({
            type: 'beat-delivery-started',
            turnId: input.turnId,
            beatId: voiceDecision.beatId,
          });
          try {
            const keepaliveInterval = setInterval(() => {
              feedStreamEvent(input.threadId, { type: 'keepalive' });
            }, 10_000);
            let generatedVoice: Awaited<ReturnType<typeof input.runtimeAdapter.synthesizeVoice>>;
            try {
              generatedVoice = await input.runtimeAdapter.synthesizeVoice({
                prompt: voiceDecision.prompt,
                voiceExecutionSnapshot: input.metadata.voiceExecutionSnapshot,
                signal: createAgentTailAbortSignal(input.threadId, input.signal),
              });
            } finally {
              clearInterval(keepaliveInterval);
            }
            voiceState = {
              status: 'complete',
              beatId: voiceDecision.beatId,
              beatIndex: voiceDecision.beatIndex,
              projectionMessageId: voiceDecision.projectionMessageId,
              prompt: voiceDecision.prompt,
              transcriptText: voiceDecision.prompt,
              sourceMessageId: voiceDecision.sourceMessageId,
              sourceActionId: voiceDecision.sourceActionId,
              mediaUrl: generatedVoice.mediaUrl,
              mimeType: generatedVoice.mimeType,
              artifactId: generatedVoice.artifactId,
              playbackCueEnvelope: generatedVoice.playbackCueEnvelope,
            };
            await input.onEvent({
              type: 'artifact-ready',
              turnId: input.turnId,
              beatId: voiceState.beatId,
              artifactId: voiceState.artifactId || voiceState.projectionMessageId,
              mimeType: voiceState.mimeType,
              projectionMessageId: voiceState.projectionMessageId,
            });
            await input.onEvent({
              type: 'beat-delivered',
              turnId: input.turnId,
              beatId: voiceState.beatId,
              projectionMessageId: voiceState.projectionMessageId,
            });
          } catch (voiceError) {
            voiceState = {
              status: 'error',
              beatId: voiceDecision.beatId,
              beatIndex: voiceDecision.beatIndex,
              projectionMessageId: voiceDecision.projectionMessageId,
              prompt: voiceDecision.prompt,
              transcriptText: voiceDecision.prompt,
              sourceMessageId: voiceDecision.sourceMessageId,
              sourceActionId: voiceDecision.sourceActionId,
              message: toChatAgentRuntimeError(voiceError).message,
            };
          }
        },
      }]),
    ...(imageDecision.status === 'none'
      ? []
      : [{
        beatId: imageDecision.beatId,
        beatIndex: imageDecision.beatIndex,
        modality: 'image' as const,
        run: async () => {
          if (imageDecision.status !== 'generate') {
            imageState = imageDecision;
            return;
          }
          await input.onEvent({
            type: 'beat-delivery-started',
            turnId: input.turnId,
            beatId: imageDecision.beatId,
          });
          try {
            const keepaliveInterval = setInterval(() => {
              feedStreamEvent(input.threadId, { type: 'keepalive' });
            }, 10_000);
            let generatedImage: Awaited<ReturnType<typeof input.runtimeAdapter.generateImage>>;
            try {
              generatedImage = await input.runtimeAdapter.generateImage({
                prompt: imageDecision.prompt,
                imageExecutionSnapshot: input.metadata.imageExecutionSnapshot,
                imageCapabilityParams: input.metadata.imageCapabilityParams,
                signal: createAgentTailAbortSignal(input.threadId, input.signal),
              });
            } finally {
              clearInterval(keepaliveInterval);
            }
            outputDiagnostics = mergeAgentImageDiagnostics(outputDiagnostics, generatedImage.diagnostics || null);
            imageState = {
              status: 'complete',
              beatId: imageDecision.beatId,
              beatIndex: imageDecision.beatIndex,
              projectionMessageId: imageDecision.projectionMessageId,
              prompt: imageDecision.prompt,
              mediaUrl: generatedImage.mediaUrl,
              mimeType: generatedImage.mimeType,
              artifactId: generatedImage.artifactId,
            };
            await input.onEvent({
              type: 'artifact-ready',
              turnId: input.turnId,
              beatId: imageState.beatId,
              artifactId: imageState.artifactId || imageState.projectionMessageId,
              mimeType: imageState.mimeType,
              projectionMessageId: imageState.projectionMessageId,
            });
            await input.onEvent({
              type: 'beat-delivered',
              turnId: input.turnId,
              beatId: imageState.beatId,
              projectionMessageId: imageState.projectionMessageId,
            });
          } catch (imageError) {
            imageState = {
              status: 'error',
              beatId: imageDecision.beatId,
              beatIndex: imageDecision.beatIndex,
              projectionMessageId: imageDecision.projectionMessageId,
              prompt: imageDecision.prompt,
              message: toChatAgentRuntimeError(imageError).message,
            };
          }
        },
      }]),
  ].sort((left, right) => left.beatIndex - right.beatIndex);
  for (const actionExecution of actionExecutions) {
    await input.onEvent({
      type: 'beat-planned',
      turnId: input.turnId,
      beatId: actionExecution.beatId,
      beatIndex: actionExecution.beatIndex,
      modality: actionExecution.modality,
    });
    await actionExecution.run();
  }
  return {
    imageState,
    voiceState,
    outputDiagnostics,
    followUpAction,
  };
}
