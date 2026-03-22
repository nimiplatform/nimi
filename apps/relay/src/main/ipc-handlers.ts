// RL-IPC-001 — All channels use 'relay:' prefix
// RL-IPC-002 — Unary IPC semantics
// RL-IPC-004 — Preload security boundary
// RL-IPC-005 — Serialization constraints
// RL-IPC-006 — AI Consume IPC
// RL-IPC-007 — Media IPC
// RL-CORE-004 — agentId in every agent-scoped IPC input
// RL-BOOT-005 — Auth IPC

import { ipcMain, type WebContents } from 'electron';
import type { PlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  SpeechListVoicesInput,
  ImageGenerateInput,
} from '@nimiplatform/sdk/runtime';
import { openStream, cancelStream } from './stream-manager.js';
import { normalizeError, toIpcError } from './error-utils.js';
import { safeHandle } from './ipc-utils.js';
import { toTextGenerateInput, toTextStreamInput, type IpcAiGenerateInput, type IpcAiStreamInput } from './input-transform.js';
import type { RelayEnv } from './env.js';
import type { RouteState } from './route/route-state.js';
import type { RelayInvokeMap } from '../shared/ipc-contract.js';
import type { TurnDeliveryScheduleHandle } from './chat-pipeline/session-persist.js';
import { resolveRelayTtsConfig } from './tts-config.js';
export { registerAuthIpcHandlers } from './ipc-auth-handlers.js';

type ListCreatorAgentsResult = RealmServiceResult<'CreatorService', 'creatorControllerListAgents'>;
type TtsSynthesizeRequest = RelayInvokeMap['relay:media:tts:synthesize']['request'];
type SttTranscribeRequest = RelayInvokeMap['relay:media:stt:transcribe']['request'];
type VideoGenerateRequest = RelayInvokeMap['relay:media:video:generate']['request'];
type ActiveRelayChatTurn = {
  abortController: AbortController;
  scheduleHandle: TurnDeliveryScheduleHandle | null;
};

function decodeBase64Audio(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, 'base64'));
}

function encodeArtifactBytes(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.byteLength === 0) {
    return undefined;
  }
  return Buffer.from(bytes).toString('base64');
}

const RELAY_REASON_CODE_MISSING_AGENT_ID = ReasonCode.AI_INPUT_INVALID;

function requireAgentId(input: unknown): void {
  const agentId = input && typeof input === 'object' && 'agentId' in input
    ? (input as { agentId?: unknown }).agentId
    : undefined;
  if (!agentId || typeof agentId !== 'string') {
    throw Object.assign(new Error('agentId is required for agent-scoped IPC calls'), {
      reasonCode: RELAY_REASON_CODE_MISSING_AGENT_ID,
      actionHint: 'Select an agent before using this feature',
    });
  }
}

export function registerIpcHandlers(
  runtime: PlatformClient['runtime'],
  realm: PlatformClient['realm'],
  getWebContents: () => WebContents | null,
  env: RelayEnv,
  routeState?: RouteState,
): void {
  const activeRelayChatTurns = new Map<string, ActiveRelayChatTurn>();

  // ── Config — expose non-secret env defaults to renderer (RL-CORE-003) ─
  safeHandle('relay:config', () => ({
    agentId: env.NIMI_AGENT_ID ?? null,
    worldId: env.NIMI_WORLD_ID ?? null,
  }));

  // ── Health (RL-IPC-002) ──────────────────────────────────────────────
  safeHandle('relay:health', async () => {
    try {
      const result = await runtime.health();
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      if (
        normalized.reasonCode === ReasonCode.AUTH_TOKEN_INVALID
        || normalized.reasonCode === ReasonCode.AUTH_DENIED
      ) {
        // Auth error detected in main process (before IPC serialization strips properties)
        const { invalidateAuth } = await import('./index.js');
        invalidateAuth();
      }
      throw normalized;
    }
  });

  // ── AI Consume (RL-IPC-006, RL-CORE-004) ────────────────────────────
  // Calls runtime.ai.text.generate() / runtime.ai.text.stream() per spec
  // Input shape: { agentId, prompt, model?, provider?, ... }

  safeHandle('relay:ai:generate', async (_event, input: IpcAiGenerateInput) => {
    requireAgentId(input);
    try {
      const textInput = toTextGenerateInput(input);
      const result = await runtime.ai.text.generate(textInput);
      return result;
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:ai:stream:open', async (_event, input: IpcAiStreamInput) => {
    requireAgentId(input);
    const wc = getWebContents();
    if (!wc) {
      throw new Error('No renderer available');
    }
    try {
      const textInput = toTextStreamInput(input);
      const stream = await runtime.ai.text.stream(textInput);
      return await openStream('ai', stream.stream, wc);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:ai:stream:cancel', (_event, payload: { streamId: string }) => {
    cancelStream(payload.streamId);
  });

  // ── Media (RL-IPC-007) ──────────────────────────────────────────────

  // TTS
  safeHandle('relay:media:tts:synthesize', async (_event, input: TtsSynthesizeRequest) => {
    requireAgentId(input);
    try {
      const { agentId: _agentId, voiceId: _voiceId, ...runtimeInput } = input;
      const { loadRelaySettings } = await import('./settings/settings-store.js');
      const settings = await loadRelaySettings();
      const resolved = resolveRelayTtsConfig(settings.inspect, input);
      if (!resolved.connectorId) {
        throw new Error('TTS connector not configured. Please select a Voice Model (TTS) in Settings.');
      }
      if (!resolved.model) {
        throw new Error('TTS model not configured. Please select a Voice Model (TTS) in Settings.');
      }
      if (!resolved.voiceId) {
        throw new Error('TTS voice not configured. Please select a Voice in Settings.');
      }
      console.info('[relay:tts] synthesize-resolved', {
        connectorId: resolved.connectorId,
        requestedModel: resolved.requestedModel || null,
        settingsModel: resolved.settingsModel || null,
        modelResolved: resolved.model,
        requestedVoice: resolved.requestedVoice || null,
        settingsVoice: resolved.settingsVoice || null,
        voiceResolved: resolved.voiceId,
      });
      const result = await runtime.media.tts.synthesize({
        ...runtimeInput,
        model: resolved.model,
        voice: resolved.voiceId,
        route: 'cloud' as const,
        connectorId: resolved.connectorId,
      });
      const artifact = result.artifacts[0];
      return {
        ...result,
        artifact,
        audio: encodeArtifactBytes(artifact?.bytes),
      };
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:media:tts:voices', async (_event, input: SpeechListVoicesInput) => {
    try {
      return await runtime.media.tts.listVoices(input);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // STT
  safeHandle('relay:media:stt:transcribe', async (_event, input: SttTranscribeRequest) => {
    try {
      const { audio, format, ...runtimeInput } = input;
      return await runtime.media.stt.transcribe({
        ...runtimeInput,
        model: runtimeInput.model || 'auto',
        mimeType: input.mimeType || `audio/${format}`,
        audio: {
          kind: 'bytes',
          bytes: decodeBase64Audio(audio),
        },
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // Image
  safeHandle('relay:media:image:generate', async (_event, input: Omit<ImageGenerateInput, 'signal'>) => {
    try {
      const { loadRelaySettings } = await import('./settings/settings-store.js');
      const settings = await loadRelaySettings();
      const imgConnector = settings.inspect.imageConnectorId;
      const imgModel = settings.inspect.imageModel;
      return await runtime.media.image.generate({
        ...input,
        model: input.model || imgModel || 'auto',
        ...(imgConnector ? { route: 'cloud' as const, connectorId: imgConnector } : {}),
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // Video
  safeHandle('relay:media:video:generate', async (_event, input: VideoGenerateRequest) => {
    requireAgentId(input);
    try {
      const { loadRelaySettings } = await import('./settings/settings-store.js');
      const settings = await loadRelaySettings();
      const vidConnector = settings.inspect.videoConnectorId;
      const vidModel = settings.inspect.videoModel;
      return await runtime.media.video.generate({
        mode: 't2v',
        model: input.model || vidModel || 'auto',
        prompt: input.prompt,
        content: [
          {
            type: 'text',
            text: input.prompt,
          },
        ],
        ...(vidConnector ? { route: 'cloud' as const, connectorId: vidConnector } : {}),
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:media:video:job:get', async (_event, payload: { jobId: string }) => {
    try {
      return await runtime.media.jobs.get(payload.jobId);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:media:video:job:artifacts', async (_event, payload: { jobId: string }) => {
    try {
      return await runtime.media.jobs.getArtifacts(payload.jobId);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // Video job subscription — stream protocol (RL-IPC-003)
  safeHandle('relay:media:video:job:subscribe', async (_event, payload: { jobId: string }) => {
    const wc = getWebContents();
    if (!wc) {
      throw new Error('No renderer available');
    }
    try {
      const stream = await runtime.media.jobs.subscribe(payload.jobId);
      return await openStream('videoJob', stream, wc);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:media:video:job:cancel', (_event, payload: { streamId: string }) => {
    cancelStream(payload.streamId);
  });

  safeHandle('relay:agent:list', async () => {
    try {
      const payload: ListCreatorAgentsResult = await realm.services.CreatorService.creatorControllerListAgents();
      return {
        items: payload.map((item) => ({
          agentId: item.id,
          displayName: item.displayName,
          handle: item.handle,
          state: String(item.status || ''),
          avatarUrl: item.avatarUrl ?? null,
        })),
      };
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:agent:get', async (_event, input: { agentId: string }) => {
    try {
      return await realm.services.AgentsService.getAgent(input.agentId);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // ── Chat Pipeline (RL-PIPE-*) ──────────────────────────────────────
  // These handlers bridge the renderer to the beat-first turn pipeline
  // running in the main process.

  safeHandle('relay:chat:send', async (_event, input: {
    agentId: string;
    text: string;
    sessionId?: string;
  }) => {
    requireAgentId(input);
    const wc = getWebContents();
    if (!wc) throw new Error('No renderer available');
    const abortController = new AbortController();
    let activeTurnTxnId = '';
    let scheduleRegistered = false;

    const bindActiveTurnTxnId = (turnTxnId?: string) => {
      const normalizedTurnTxnId = String(turnTxnId || '').trim();
      if (!normalizedTurnTxnId) {
        return;
      }
      activeTurnTxnId = normalizedTurnTxnId;
      if (!activeRelayChatTurns.has(normalizedTurnTxnId)) {
        activeRelayChatTurns.set(normalizedTurnTxnId, {
          abortController,
          scheduleHandle: null,
        });
      }
    };

    try {
      // Dynamic import to avoid circular dependency at registration time
      const { createRelayAiClient } = await import('./chat-pipeline/relay-ai-client.js');
      const { createMainProcessChatContext } = await import('./chat-pipeline/main-process-context.js');

      // Resolve route from route state for model selection
      const resolvedRoute = routeState?.getResolved() ?? null;

      // Load inspect settings for media routes
      const { loadRelaySettings } = await import('./settings/settings-store.js');
      const chatSettings = await loadRelaySettings();
      const mediaRoutes = {
        image: chatSettings.inspect.imageConnectorId
          ? { connectorId: chatSettings.inspect.imageConnectorId, model: chatSettings.inspect.imageModel }
          : undefined,
        video: chatSettings.inspect.videoConnectorId
          ? { connectorId: chatSettings.inspect.videoConnectorId, model: chatSettings.inspect.videoModel }
          : undefined,
        tts: chatSettings.inspect.ttsConnectorId
          ? { connectorId: chatSettings.inspect.ttsConnectorId, model: chatSettings.inspect.ttsModel }
          : undefined,
      };
      const aiClient = createRelayAiClient(runtime, resolvedRoute, mediaRoutes);

      // Hydrate context with existing session history so setMessages
      // appends to previous turns rather than broadcasting from empty.
      let initialMessages: import('./chat-pipeline/types.js').ChatMessage[] = [];
      try {
        const { listLocalChatSessions } = await import('./session-store/index.js');
        const sessions = await listLocalChatSessions(input.agentId, 'local-user');
        if (sessions.length > 0 && sessions[0]) {
          initialMessages = sessions[0].turns
            .filter((turn): turn is typeof turn & { role: 'user' | 'assistant' } =>
              turn.role === 'user' || turn.role === 'assistant',
            )
            .map((turn) => ({
              id: turn.id,
              role: turn.role,
              kind: turn.kind,
              content: turn.content,
              timestamp: typeof turn.timestamp === 'string' ? new Date(turn.timestamp) : turn.timestamp,
              latencyMs: turn.latencyMs,
              meta: turn.meta,
              media: turn.media,
            }));
        }
      } catch (err) {
        console.warn('[relay:chat] history hydration failed, proceeding with empty context', err);
      }
      const chatContext = createMainProcessChatContext(wc, initialMessages);

      const { DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS } = await import('./settings/types.js');

      // Merge user's actual settings into defaults so media decision policy
      // can see configured image/tts/video connectors and models.
      const effectiveSettings = {
        ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
        ...chatSettings.product,
        ...chatSettings.inspect,
      };

      // Build route snapshot from resolved route
      const routeSnapshot = resolvedRoute
        ? {
            source: resolvedRoute.source,
            model: resolvedRoute.model,
            connectorId: resolvedRoute.connectorId,
            provider: resolvedRoute.provider,
            localModelId: resolvedRoute.localModelId,
          }
        : null;

      // Resolve agent target from agentId via Realm queries
      const { fetchTargetProfile } = await import('./data/realm-queries.js');
      const selectedTarget = await fetchTargetProfile(realm, input.agentId);

      const sendFlowModule = await import('./chat-pipeline/send-flow.js');
      const contextKeyRef = { sessionId: input.sessionId || '' };
      await sendFlowModule.runLocalChatTurnSend({
        context: {
          aiClient,
          inputText: input.text,
          viewerId: 'local-user',
          viewerDisplayName: 'User',
          runtimeMode: undefined,
          routeSnapshot,
          defaultSettings: effectiveSettings,
          selectedTarget,
          selectedSessionId: input.sessionId || '',
          messages: chatContext.messages,
          onSessionResolved: (sessionId: string) => { contextKeyRef.sessionId = sessionId; },
        },
        chatContext,
        abortSignal: abortController.signal,
        setSendPhase: (phase, turnTxnId) => {
          bindActiveTurnTxnId(turnTxnId);
          chatContext.setSendPhase(phase, turnTxnId);
        },
        getCurrentContextKey: () => [input.agentId, contextKeyRef.sessionId].join('|'),
        registerSchedule: ({ handle }) => {
          bindActiveTurnTxnId(handle.turnTxnId);
          scheduleRegistered = true;
          activeRelayChatTurns.set(handle.turnTxnId, {
            abortController,
            scheduleHandle: handle,
          });
          void handle.done.finally(() => {
            activeRelayChatTurns.delete(handle.turnTxnId);
          });
        },
        clearScheduleByTxn: (turnTxnId) => {
          activeRelayChatTurns.delete(turnTxnId);
        },
      });
      if (!scheduleRegistered && activeTurnTxnId) {
        activeRelayChatTurns.delete(activeTurnTxnId);
      }
    } catch (error) {
      if (activeTurnTxnId) {
        activeRelayChatTurns.delete(activeTurnTxnId);
      }
      const wc2 = getWebContents();
      if (wc2) {
        wc2.send('relay:chat:status-banner', {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
        wc2.send('relay:chat:turn:phase', { phase: 'idle' });
      }
      throw toIpcError(error);
    }
  });

  safeHandle('relay:chat:cancel', (_event, input: { turnTxnId: string }) => {
    const turnTxnId = String(input.turnTxnId || '').trim();
    if (!turnTxnId) {
      throw Object.assign(new Error('turnTxnId is required to cancel relay chat turns'), {
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'retry_with_active_turn_transaction_id',
      });
    }
    const activeTurn = activeRelayChatTurns.get(turnTxnId);
    if (!activeTurn) {
      throw Object.assign(new Error(`relay chat turn is not cancellable: ${turnTxnId}`), {
        reasonCode: ReasonCode.ACTION_NOT_FOUND,
        actionHint: 'wait_for_active_turn_then_retry_cancel',
      });
    }
    activeTurn.abortController.abort();
    activeTurn.scheduleHandle?.cancel('LOCAL_CHAT_SCHEDULE_CANCELLED_BY_USER');
  });

  safeHandle('relay:chat:history', async (_event, input: { agentId: string }) => {
    try {
      const { listLocalChatSessions } = await import('./session-store/index.js');
      const sessions = await listLocalChatSessions(input.agentId, 'local-user');
      if (sessions.length > 0 && sessions[0]) {
        return sessions[0].turns.map((turn) => ({
          id: turn.id,
          role: turn.role,
          kind: turn.kind,
          content: turn.content,
          timestamp: turn.timestamp,
          latencyMs: turn.latencyMs,
          meta: turn.meta,
          media: turn.media,
        }));
      }
      return [];
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:chat:clear', async (_event, input: { agentId: string; sessionId: string }) => {
    try {
      const { clearSession } = await import('./session-store/index.js');
      await clearSession(input.sessionId);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:chat:settings:get', async () => {
    try {
      const { loadRelaySettings } = await import('./settings/settings-store.js');
      return await loadRelaySettings();
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:chat:settings:set', async (_event, patch: Record<string, unknown>) => {
    try {
      const { loadRelaySettings, saveRelaySettings } = await import('./settings/settings-store.js');
      const { normalizeLocalChatProductSettings, normalizeLocalChatInspectSettings } = await import('./settings/types.js');
      // Merge patch into existing settings instead of replacing,
      // so saving inspect doesn't reset product and vice versa.
      const existing = await loadRelaySettings();
      if (patch.product && typeof patch.product === 'object') {
        existing.product = normalizeLocalChatProductSettings({ ...existing.product, ...(patch.product as Record<string, unknown>) });
      }
      if (patch.inspect && typeof patch.inspect === 'object') {
        existing.inspect = normalizeLocalChatInspectSettings({ ...existing.inspect, ...(patch.inspect as Record<string, unknown>) });
      }
      await saveRelaySettings(existing, { flush: true });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  safeHandle('relay:chat:proactive:toggle', async (_event, input: { enabled: boolean }) => {
    try {
      const { loadRelaySettings, saveRelaySettings } = await import('./settings/settings-store.js');
      const settings = await loadRelaySettings();
      settings.product.allowProactiveContact = input.enabled;
      await saveRelaySettings(settings, { flush: true });
    } catch (error) {
      throw toIpcError(error);
    }
  });
}
