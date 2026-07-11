export type {
  JsonArray,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RendererLogLevel,
  RendererLogMessage,
  RendererLogPayload,
  RuntimeBridgeStructuredError,
} from './shared.js';

export type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeDefaults,
  SystemResourceSnapshot,
  RuntimeBridgeDaemonStatus,
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
  DesktopMacosSmokeContext,
  DesktopMacosSmokeReportPayload,
  DesktopMacosSmokeReportResult,
} from './runtime-types.js';

export {
  parseDesktopReleaseInfo,
  parseDesktopUpdateCheckResult,
  parseDesktopUpdateState,
  parseRuntimeDefaults,
  parseSystemResourceSnapshot,
  parseRuntimeBridgeDaemonStatus,
  parseMenuBarProviderSummary,
  parseDesktopMacosSmokeContext,
  parseDesktopMacosSmokeReportResult,
} from './runtime-parsers.js';

export type {
  ChatAiMessageRole,
  ChatAiMessageStatus,
  ChatAiThreadSummary,
  ChatAiThreadRecord,
  ChatAiMessagePart,
  ChatAiToolCallError,
  ChatAiToolCall,
  ChatAiAttachment,
  ChatAiMessageContent,
  ChatAiMessageError,
  ChatAiMessageRecord,
  ChatAiDraftRecord,
  ChatAiThreadBundle,
  ChatAiCreateThreadInput,
  ChatAiUpdateThreadMetadataInput,
  ChatAiCreateMessageInput,
  ChatAiUpdateMessageInput,
  ChatAiPutDraftInput,
} from './chat-ai-types.js';

export {
  parseChatAiAttachment,
  parseChatAiMessageContent,
  parseChatAiMessageError,
  parseChatAiThreadSummary,
  parseChatAiThreadSummaries,
  parseChatAiThreadRecord,
  parseChatAiMessageRecord,
  parseChatAiDraftRecord,
  parseChatAiThreadBundle,
  parseChatAiCreateThreadInput,
  parseChatAiUpdateThreadMetadataInput,
  parseChatAiCreateMessageInput,
  parseChatAiUpdateMessageInput,
  parseChatAiPutDraftInput,
} from './chat-ai-parsers.js';

export type {
  AgentLocalMessageRole,
  AgentLocalMessageStatus,
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
  AgentLocalThreadRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
} from './chat-agent-types.js';

import './window-global.js';
