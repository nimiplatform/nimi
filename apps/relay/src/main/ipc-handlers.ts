// RL-IPC-001 — All channels use 'relay:' prefix
// RL-IPC-002 — Unary IPC semantics
// RL-IPC-004 — Preload security boundary
// RL-IPC-005 — Serialization constraints
// RL-IPC-006 — AI Consume IPC
// RL-IPC-007 — Media IPC
// RL-CORE-004 — agentId in every agent-scoped IPC input
// RL-BOOT-005 — Auth IPC

import { ipcMain, shell, type BrowserWindow, type WebContents } from 'electron';
import { createPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import { OAuthProvider } from '@nimiplatform/sdk/realm';
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
import { listenForOAuthCallback, performOauthTokenExchange } from './auth/index.js';
import { DESKTOP_CALLBACK_TIMEOUT_MS } from '@nimiplatform/shell-core/oauth';
import type { RouteState } from './route/route-state.js';
import type { RelayInvokeMap } from '../shared/ipc-contract.js';
import { resolveRelayTtsConfig } from './tts-config.js';

type ListCreatorAgentsResult = RealmServiceResult<'CreatorService', 'creatorControllerListAgents'>;
type AuthOauthLoginRequest = RelayInvokeMap['relay:auth:oauth-login']['request'];
type TtsSynthesizeRequest = RelayInvokeMap['relay:media:tts:synthesize']['request'];
type SttTranscribeRequest = RelayInvokeMap['relay:media:stt:transcribe']['request'];
type VideoGenerateRequest = RelayInvokeMap['relay:media:video:generate']['request'];

function decodeBase64Audio(input: string): Uint8Array {
  return Uint8Array.from(Buffer.from(input, 'base64'));
}

function encodeArtifactBytes(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.byteLength === 0) {
    return undefined;
  }
  return Buffer.from(bytes).toString('base64');
}

async function createScopedRealm(
  env: RelayEnv,
  accessToken?: string,
): Promise<PlatformClient['realm']> {
  const normalizedAccessToken = String(
    accessToken ?? env.NIMI_ACCESS_TOKEN ?? '',
  ).trim();

  const client = await createPlatformClient({
    appId: 'nimi.relay',
    realmBaseUrl: env.NIMI_REALM_URL,
    accessToken: normalizedAccessToken,
    allowAnonymousRealm: !normalizedAccessToken,
    runtimeTransport: null,
  });
  return client.realm;
}

/**
 * Register auth-related + OAuth primitive IPC handlers.
 * Called early in boot (before auth resolution) so the renderer
 * can query auth state, apply tokens, and drive OAuth flows.
 */
export function registerAuthIpcHandlers(
  env: RelayEnv,
  getMainWindow: () => BrowserWindow | null,
): void {
  // ── Logout (invalidate token + revert to login page) ─────────────────
  ipcMain.handle('relay:auth:logout', async () => {
    const { invalidateAuth } = await import('./index.js');
    invalidateAuth();
  });

  // ── Auth status ────────────────────────────────────────────────────────
  ipcMain.handle('relay:auth:status', async () => {
    const { getAuthState } = await import('./index.js');
    return getAuthState();
  });

  // ── Apply token (renderer calls after successful Social OAuth) ────────
  ipcMain.handle('relay:auth:apply-token', async (_event, payload: { accessToken: string }) => {
    const { applyTokenAndInit } = await import('./index.js');
    try {
      await applyTokenAndInit(payload.accessToken);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('relay:auth:check-email', async (_event, payload: { email: string }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.checkEmail({
        email: payload.email,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:password-login', async (_event, payload: {
    identifier: string;
    password: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.passwordLogin({
        identifier: payload.identifier,
        password: payload.password,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:oauth-login', async (_event, payload: AuthOauthLoginRequest) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.oauthLogin({
        provider: payload.provider as OAuthProvider,
        accessToken: payload.accessToken,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:email-otp-request', async (_event, payload: { email: string }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.requestEmailOtp({
        email: payload.email,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:email-otp-verify', async (_event, payload: {
    email: string;
    code: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.verifyEmailOtp({
        email: payload.email,
        code: payload.code,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:2fa-verify', async (_event, payload: {
    tempToken: string;
    code: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.verifyTwoFactor({
        tempToken: payload.tempToken,
        code: payload.code,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:wallet-challenge', async (_event, payload: {
    walletAddress: string;
    chainId?: number;
    walletType: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.walletChallenge({
        walletAddress: payload.walletAddress,
        chainId: payload.chainId,
        walletType: payload.walletType,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:wallet-login', async (_event, payload: {
    walletAddress: string;
    chainId?: number;
    nonce: string;
    message: string;
    signature: string;
    walletType: string;
  }) => {
    try {
      return await (await createScopedRealm(env)).services.AuthService.walletLogin({
        walletAddress: payload.walletAddress,
        chainId: payload.chainId,
        nonce: payload.nonce,
        message: payload.message,
        signature: payload.signature,
        walletType: payload.walletType,
      });
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:update-password', async (_event, payload: {
    newPassword: string;
    accessToken?: string;
  }) => {
    try {
      await (await createScopedRealm(env, payload.accessToken)).services.AuthService.updatePassword({
        newPassword: payload.newPassword,
      });
      return { success: true };
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('relay:auth:current-user', async (_event, payload?: {
    accessToken?: string;
  }) => {
    try {
      return await (await createScopedRealm(env, payload?.accessToken)).services.MeService.getMe();
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // ── OAuth primitives ──────────────────────────────────────────────────

  // Listen for OAuth callback on loopback HTTP server
  ipcMain.handle('relay:oauth:listen-for-code', async (_event, payload: {
    redirectUri: string;
    timeoutMs?: number;
  }) => {
    const result = await listenForOAuthCallback({
      redirectUri: payload.redirectUri,
      timeoutMs: payload.timeoutMs ?? DESKTOP_CALLBACK_TIMEOUT_MS,
    });
    // Adapt LoopbackListenerResult → OauthListenForCodeResult
    return {
      callbackUrl: payload.redirectUri,
      code: result.code || undefined,
      state: result.state || undefined,
      error: undefined,
    };
  });

  // Open URL in system browser
  ipcMain.handle('relay:oauth:open-external-url', async (_event, payload: { url: string }) => {
    await shell.openExternal(payload.url);
    return { opened: true };
  });

  // Focus the main window (after OAuth callback returns)
  ipcMain.handle('relay:oauth:focus-main-window', async () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.handle('relay:oauth:token-exchange', async (_event, payload) => {
    try {
      return await performOauthTokenExchange(payload);
    } catch (error) {
      throw toIpcError(error);
    }
  });
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

  safeHandle('relay:human-chat:send', async (_event, input: { agentId: string; text: string }) => {
    try {
      const started = await realm.services.HumanChatService.startChat({
        targetAccountId: input.agentId,
      });
      return await realm.services.HumanChatService.sendMessage(started.chatId, {
        clientMessageId: `relay-agent-channel:${input.agentId}:${Date.now()}`,
        type: 'TEXT',
        text: input.text,
      });
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

      // Try full pipeline, fall back to simple streaming
      const sendFlowModule = await import('./chat-pipeline/send-flow.js').catch(() => null);

      if (sendFlowModule) {
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
          setSendPhase: (phase) => chatContext.setSendPhase(phase),
          getCurrentContextKey: () => [input.agentId, contextKeyRef.sessionId].join('|'),
          registerSchedule: () => {},
          clearScheduleByTxn: () => {},
        });
      } else {
        // Fallback: direct SDK streaming (backward compatible with old behavior)
        const textInput = toTextStreamInput({ agentId: input.agentId, prompt: input.text });
        const stream = await runtime.ai.text.stream(textInput);

        const userMsg = {
          id: `user_${Date.now()}`,
          role: 'user' as const,
          kind: 'text' as const,
          content: input.text,
          timestamp: new Date(),
        };

        const assistantMsg = {
          id: `assistant_${Date.now()}`,
          role: 'assistant' as const,
          kind: 'streaming' as const,
          content: '',
          timestamp: new Date(),
        };

        chatContext.setMessages([...chatContext.messages, userMsg, assistantMsg]);
        chatContext.setSendPhase('streaming-first-beat');

        let fullText = '';
        for await (const event of stream.stream) {
          if (event.type === 'delta') {
            const delta = event as unknown as { text?: string };
            if (delta.text) {
              fullText += delta.text;
              chatContext.setMessages([
                ...chatContext.messages.filter((m) => m.id !== assistantMsg.id),
                userMsg,
                { ...assistantMsg, content: fullText },
              ]);
            }
          }
        }

        chatContext.setMessages([
          ...chatContext.messages.filter((m) => m.id !== assistantMsg.id),
          userMsg,
          { ...assistantMsg, kind: 'text' as const, content: fullText },
        ]);
        chatContext.setSendPhase('idle');
      }
    } catch (error) {
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

  safeHandle('relay:chat:cancel', (_event, _input: { turnTxnId: string }) => {
    // TODO: wire to AbortController in send-flow
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
