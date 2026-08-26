import type {
  GetLocalAppConversationSnapshotRequest,
  GetLocalAppConversationSnapshotResponse,
  InterruptLocalAppConversationTurnRequest,
  InterruptLocalAppConversationTurnResponse,
  LocalAppConversationAction,
  LocalAppConversationEvent,
  LocalAppConversationMessage,
  LocalAppConversationSnapshot,
  LocalAppConversationTurn,
  LocalAppConversationVoice,
  OpenLocalAppConversationRequest,
  OpenLocalAppConversationResponse,
  ReadLocalAppConversationArtifactRequest,
  ReadLocalAppConversationArtifactResponse,
  SendLocalAppConversationTurnRequest,
  SendLocalAppConversationTurnResponse,
  SubscribeLocalAppConversationEventsRequest,
  TranscribeLocalAppConversationVoiceRequest,
  TranscribeLocalAppConversationVoiceResponse,
  UploadLocalAppConversationAttachmentRequest,
  UploadLocalAppConversationAttachmentResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_service';
import {
  LocalAppConversationActionStatus,
  LocalAppConversationLiveChildLifecycle,
  LocalAppConversationMediaKind,
  LocalAppConversationMessageRole,
  LocalAppConversationReasoningState,
  LocalAppConversationTurnPhase,
  LocalAppConversationTurnStatus,
  LocalAppConversationVoiceState,
} from '../../core-generated/runtime-protobuf/runtime/v1/agent_service';
import { ReasonCode } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import {
  createNimiLocalAppConversationClient,
  type NimiLocalAppConversationClient,
  type NimiLocalAppConversationShell,
} from './local-app-runtime-platform-conversation.js';

export type NimiLocalAppConversationRuntime = {
  readonly openLocalAppConversation: (request: OpenLocalAppConversationRequest) => Promise<OpenLocalAppConversationResponse>;
  readonly sendLocalAppConversationTurn: (request: SendLocalAppConversationTurnRequest) => Promise<SendLocalAppConversationTurnResponse>;
  readonly uploadLocalAppConversationAttachment: (request: UploadLocalAppConversationAttachmentRequest) => Promise<UploadLocalAppConversationAttachmentResponse>;
  readonly readLocalAppConversationArtifact: (request: ReadLocalAppConversationArtifactRequest) => Promise<ReadLocalAppConversationArtifactResponse>;
  readonly transcribeLocalAppConversationVoice: (request: TranscribeLocalAppConversationVoiceRequest, options?: { readonly signal?: AbortSignal }) => Promise<TranscribeLocalAppConversationVoiceResponse>;
  readonly interruptLocalAppConversationTurn: (request: InterruptLocalAppConversationTurnRequest) => Promise<InterruptLocalAppConversationTurnResponse>;
  readonly subscribeLocalAppConversationEvents: (request: SubscribeLocalAppConversationEventsRequest, options?: { readonly signal?: AbortSignal }) => AsyncIterable<LocalAppConversationEvent>;
  readonly getLocalAppConversationSnapshot: (request: GetLocalAppConversationSnapshotRequest) => Promise<GetLocalAppConversationSnapshotResponse>;
};

export function createNimiLocalAppConversationRuntimeClient(
  runtime: NimiLocalAppConversationRuntime,
): NimiLocalAppConversationClient {
  const shell: NimiLocalAppConversationShell = {
    open: async ({ agentHandle }) => {
      const response = await runtime.openLocalAppConversation({ agentHandle });
      return { conversationAnchorId: response.conversationAnchorId, activeTurnId: response.activeTurnId ?? null };
    },
    send: async ({ agentHandle, conversationAnchorId, requestId, parts }) => {
      const response = await runtime.sendLocalAppConversationTurn({
        agentHandle, conversationAnchorId, requestId,
        parts: parts.map((part) => part.kind === 'text'
          ? { part: { oneofKind: 'text', text: { text: part.text } } }
          : { part: { oneofKind: 'artifactRef', artifactRef: { artifactId: part.artifactId } } }),
      });
      return { turnId: response.turnId };
    },
    uploadAttachment: async ({ agentHandle, conversationAnchorId, mimeType, displayName, bytes }) => {
      const response = await runtime.uploadLocalAppConversationAttachment({
        agentHandle, conversationAnchorId, mimeType, displayName, data: Uint8Array.from(bytes),
      });
      return { artifactId: response.artifactId, expiresAt: response.expiresAt };
    },
    readArtifact: async ({ agentHandle, conversationAnchorId, artifactId }) => {
      const response = await runtime.readLocalAppConversationArtifact({ agentHandle, conversationAnchorId, artifactId });
      return { artifactId: response.artifactId, bytes: Array.from(response.data), mimeType: response.mimeType, byteLength: Number(response.byteLength) };
    },
    transcribeVoice: async ({ agentHandle, conversationAnchorId, requestId, mimeType, audioBytes }, options) => {
      const response = await runtime.transcribeLocalAppConversationVoice({
        agentHandle, conversationAnchorId, requestId, mimeType, audioBytes: Uint8Array.from(audioBytes),
      }, options);
      return { text: response.text };
    },
    interruptTurn: async ({ agentHandle, conversationAnchorId }) => {
      const response = await runtime.interruptLocalAppConversationTurn({ agentHandle, conversationAnchorId });
      return { turnId: response.turnId };
    },
    subscribe: async ({ agentHandle, conversationAnchorId }) => {
      const controller = new AbortController();
      const source = runtime.subscribeLocalAppConversationEvents(
        { agentHandle, conversationAnchorId },
        { signal: controller.signal },
      );
      return {
        events: (async function* () {
          for await (const event of source) yield projectRuntimeEvent(event);
        })(),
        cancel: async () => controller.abort(),
      };
    },
    snapshot: async ({ agentHandle, conversationAnchorId }) => {
      const response = await runtime.getLocalAppConversationSnapshot({ agentHandle, conversationAnchorId });
      if (!response.snapshot) throw new Error('Runtime LocalApp Conversation snapshot is missing');
      return projectRuntimeSnapshot(response.snapshot);
    },
  };
  return createNimiLocalAppConversationClient(shell);
}

function projectRuntimeEvent(value: LocalAppConversationEvent): Record<string, unknown> {
  const base = { conversationAnchorId: value.conversationAnchorId, sequence: String(value.sequence) };
  switch (value.event.oneofKind) {
    case 'turnAccepted': return { ...base, type: 'turn-accepted', turnId: value.event.turnAccepted.turnId };
    case 'turnStarted': return { ...base, type: 'turn-started', turnId: value.event.turnStarted.turnId };
    case 'textDelta': return { ...base, type: 'text-delta', turnId: value.event.textDelta.turnId, delta: value.event.textDelta.delta };
    case 'reasoningStatus': return { ...base, type: 'reasoning-status', turnId: value.event.reasoningStatus.turnId, state: reasoningState(value.event.reasoningStatus.state) };
    case 'messageCommitted': {
      const message = requireMessage(value.event.messageCommitted.message);
      return { ...base, type: 'message-committed', turnId: message.turnId, message: projectMessage(message) };
    }
    case 'actionPlanned': return actionEvent(base, 'action-planned', value.event.actionPlanned.action);
    case 'actionStarted': return actionEvent(base, 'action-started', value.event.actionStarted.action);
    case 'actionCompleted': return actionEvent(base, 'action-completed', value.event.actionCompleted.action);
    case 'actionFailed': return actionEvent(base, 'action-failed', value.event.actionFailed.action);
    case 'liveAction': return { ...base, type: 'live-action', turnId: value.event.liveAction.turnId, action: projectLiveChild(value.event.liveAction, 'actionId') };
    case 'liveTool': return { ...base, type: 'live-tool', turnId: value.event.liveTool.turnId, tool: projectLiveChild(value.event.liveTool, 'toolId') };
    case 'artifactReady': return {
      ...base, type: 'artifact-ready', turnId: value.event.artifactReady.turnId,
      actionId: value.event.artifactReady.actionId, capabilityContract: value.event.artifactReady.capabilityContract,
      projectionMessageId: value.event.artifactReady.projectionMessageId, artifactId: value.event.artifactReady.artifactId,
    };
    case 'voiceReady': return voiceEvent(base, 'voice-ready', value.event.voiceReady.voice);
    case 'voiceFailed': return voiceEvent(base, 'voice-failed', value.event.voiceFailed.voice);
    case 'turnCompleted': return { ...base, type: 'turn-completed', turnId: value.event.turnCompleted.turnId, terminalReason: value.event.turnCompleted.terminalReason };
    case 'turnFailed': return { ...base, type: 'turn-failed', turnId: value.event.turnFailed.turnId, reasonCode: value.event.turnFailed.reasonCode, message: value.event.turnFailed.message ?? null };
    case 'turnInterrupted': return { ...base, type: 'turn-interrupted', turnId: value.event.turnInterrupted.turnId, reason: value.event.turnInterrupted.reason };
    default: throw new Error('Runtime emitted an unsupported LocalApp Conversation event');
  }
}

function projectRuntimeSnapshot(value: LocalAppConversationSnapshot): Record<string, unknown> {
  return {
    conversationAnchorId: value.conversationAnchorId,
    throughSequence: String(value.throughSequence),
    turns: value.turns.map(projectTurn),
    messages: value.messages.map(projectMessage),
    actions: value.actions.map(projectAction),
    voices: value.voices.map(projectVoice),
    truncatedBefore: value.truncatedBefore,
  };
}

function projectMessage(value: LocalAppConversationMessage): Record<string, unknown> {
  return {
    messageId: value.messageId, turnId: value.turnId,
    role: value.role === LocalAppConversationMessageRole.USER ? 'user' : value.role === LocalAppConversationMessageRole.ASSISTANT ? 'assistant' : '',
    parts: value.parts.map((part) => part.part.oneofKind === 'text'
      ? { kind: 'text', text: part.part.text.text }
      : part.part.oneofKind === 'artifact'
        ? { kind: 'artifact-ref', artifactId: part.part.artifact.artifactId, mediaKind: mediaKind(part.part.artifact.mediaKind), mimeType: part.part.artifact.mimeType, displayName: part.part.artifact.displayName ?? null }
        : { kind: '' }),
  };
}

function projectTurn(value: LocalAppConversationTurn): Record<string, unknown> {
  return {
    turnId: value.turnId,
    status: enumName(value.status, { [LocalAppConversationTurnStatus.ACTIVE]:'active',[LocalAppConversationTurnStatus.COMPLETED]:'completed',[LocalAppConversationTurnStatus.FAILED]:'failed',[LocalAppConversationTurnStatus.INTERRUPTED]:'interrupted' }),
    phase: value.phase === LocalAppConversationTurnPhase.ACCEPTED ? 'accepted' : value.phase === LocalAppConversationTurnPhase.STARTED ? 'started' : null,
    terminalReason: value.terminalReason ?? null, reasonCode: reasonName(value.reasonCode), message: value.message ?? null,
  };
}

function projectAction(value: LocalAppConversationAction): Record<string, unknown> {
  return {
    actionId:value.actionId,turnId:value.turnId,capabilityContract:value.capabilityContract,
    status:enumName(value.status,{[LocalAppConversationActionStatus.PLANNED]:'planned',[LocalAppConversationActionStatus.STARTED]:'started',[LocalAppConversationActionStatus.COMPLETED]:'completed',[LocalAppConversationActionStatus.FAILED]:'failed'}),
    projectionMessageId:value.projectionMessageId??null,artifactId:value.artifactId??null,reasonCode:reasonName(value.reasonCode),message:value.message??null,
  };
}

function projectVoice(value: LocalAppConversationVoice): Record<string, unknown> {
  return {voiceId:value.voiceId,turnId:value.turnId,messageId:value.messageId,state:value.state===LocalAppConversationVoiceState.READY?'ready':value.state===LocalAppConversationVoiceState.FAILED?'failed':'',artifactId:value.artifactId??null,reasonCode:reasonName(value.reasonCode),message:value.message??null};
}

function projectLiveChild(value: {turnId:string;actionId?:string;toolId?:string;name:string;lifecycle:LocalAppConversationLiveChildLifecycle;progress?:string;result?:string;reasonCode:ReasonCode}, idField:'actionId'|'toolId') {
  return {turnId:value.turnId,[idField]:value[idField]??'',name:value.name,lifecycle:enumName(value.lifecycle,{[LocalAppConversationLiveChildLifecycle.STARTED]:'started',[LocalAppConversationLiveChildLifecycle.UPDATED]:'updated',[LocalAppConversationLiveChildLifecycle.COMPLETED]:'completed',[LocalAppConversationLiveChildLifecycle.FAILED]:'failed'}),progress:value.progress??null,result:value.result??null,reasonCode:reasonName(value.reasonCode)};
}

function actionEvent(base:Record<string,unknown>,type:string,value:LocalAppConversationAction|undefined){const action=requireAction(value);return{...base,type,turnId:action.turnId,action:projectAction(action)};}
function voiceEvent(base:Record<string,unknown>,type:string,value:LocalAppConversationVoice|undefined){const voice=requireVoice(value);return{...base,type,turnId:voice.turnId,voice:projectVoice(voice)};}
function requireMessage(value:LocalAppConversationMessage|undefined){if(!value)throw new Error('Runtime Conversation message is missing');return value;}
function requireAction(value:LocalAppConversationAction|undefined){if(!value)throw new Error('Runtime Conversation action is missing');return value;}
function requireVoice(value:LocalAppConversationVoice|undefined){if(!value)throw new Error('Runtime Conversation voice is missing');return value;}
function reasonName(value:ReasonCode){return value===ReasonCode.REASON_CODE_UNSPECIFIED?null:ReasonCode[value]??null;}
function reasoningState(value:LocalAppConversationReasoningState){return enumName(value,{[LocalAppConversationReasoningState.STARTED]:'started',[LocalAppConversationReasoningState.ACTIVE]:'active',[LocalAppConversationReasoningState.COMPLETED]:'completed'});}
function mediaKind(value:LocalAppConversationMediaKind){return value===LocalAppConversationMediaKind.IMAGE?'image':'';}
function enumName<T extends number,V extends string>(value:T,names:Record<number,V>):V|''{return names[value]??'';}
