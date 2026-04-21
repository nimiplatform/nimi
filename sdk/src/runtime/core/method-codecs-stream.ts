import { RuntimeMethodIds } from '../method-ids';
import {
  RealtimeEvent,
  ReadRealtimeEventsRequest,
  ScenarioJobEvent,
  StreamScenarioEvent,
  StreamScenarioRequest,
  SubscribeScenarioJobEventsRequest,
} from '../generated/runtime/v1/ai';
import {
  WorkflowEvent,
  SubscribeWorkflowEventsRequest,
} from '../generated/runtime/v1/workflow';
import {
  LocalTransferProgressEvent,
  WatchLocalTransfersRequest,
} from '../generated/runtime/v1/local_runtime';
import {
  MemoryEvent,
  SubscribeMemoryEventsRequest,
} from '../generated/runtime/v1/memory';
import {
  AgentEvent,
  SubscribeAgentEventsRequest,
} from '../generated/runtime/v1/agent_service';
import {
  AppMessageEvent,
  SubscribeAppMessagesRequest,
} from '../generated/runtime/v1/app';
import {
  AIProviderHealthEvent,
  AuditExportChunk,
  ExportAuditEventsRequest,
  RuntimeHealthEvent,
  SubscribeAIProviderHealthEventsRequest,
  SubscribeRuntimeHealthEventsRequest,
} from '../generated/runtime/v1/audit';
import type { RuntimeStreamMethodCodecMap } from './method-codecs-types';

export const runtimeStreamMethodCodecs: RuntimeStreamMethodCodecMap = {
  [RuntimeMethodIds.ai.streamScenario]: {
    requestType: StreamScenarioRequest,
    eventType: StreamScenarioEvent,
  },
  [RuntimeMethodIds.ai.subscribeScenarioJobEvents]: {
    requestType: SubscribeScenarioJobEventsRequest,
    eventType: ScenarioJobEvent,
  },
  [RuntimeMethodIds.aiRealtime.readRealtimeEvents]: {
    requestType: ReadRealtimeEventsRequest,
    eventType: RealtimeEvent,
  },
  [RuntimeMethodIds.workflow.subscribeEvents]: {
    requestType: SubscribeWorkflowEventsRequest,
    eventType: WorkflowEvent,
  },
  [RuntimeMethodIds.local.watchLocalTransfers]: {
    requestType: WatchLocalTransfersRequest,
    eventType: LocalTransferProgressEvent,
  },
  [RuntimeMethodIds.memory.subscribeEvents]: {
    requestType: SubscribeMemoryEventsRequest,
    eventType: MemoryEvent,
  },
  [RuntimeMethodIds.agent.subscribeEvents]: {
    requestType: SubscribeAgentEventsRequest,
    eventType: AgentEvent,
  },
  [RuntimeMethodIds.app.subscribeAppMessages]: {
    requestType: SubscribeAppMessagesRequest,
    eventType: AppMessageEvent,
  },
  [RuntimeMethodIds.audit.exportAuditEvents]: {
    requestType: ExportAuditEventsRequest,
    eventType: AuditExportChunk,
  },
  [RuntimeMethodIds.audit.subscribeAIProviderHealthEvents]: {
    requestType: SubscribeAIProviderHealthEventsRequest,
    eventType: AIProviderHealthEvent,
  },
  [RuntimeMethodIds.audit.subscribeRuntimeHealthEvents]: {
    requestType: SubscribeRuntimeHealthEventsRequest,
    eventType: RuntimeHealthEvent,
  },
};
