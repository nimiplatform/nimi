// RL-IPC-001 — All channels use 'relay:' prefix
// RL-IPC-002 — Unary IPC semantics
// RL-IPC-004 — Preload security boundary
// RL-IPC-005 — Serialization constraints
// RL-IPC-006 — AI Consume IPC
// RL-IPC-007 — Media IPC
// RL-IPC-008 — Realm Passthrough IPC
// RL-CORE-004 — agentId in every agent-scoped IPC input
// RL-BOOT-005 — Auth IPC

import { ipcMain, shell, type BrowserWindow, type WebContents } from 'electron';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { OAuthProvider, Realm } from '@nimiplatform/sdk/realm';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  SpeechSynthesizeInput,
  SpeechListVoicesInput,
  SpeechTranscribeInput,
  ImageGenerateInput,
  VideoGenerateInput,
} from '@nimiplatform/sdk/runtime';
import { openStream, cancelStream } from './stream-manager.js';
import { normalizeError } from './error-utils.js';
import { toTextGenerateInput, toTextStreamInput, type IpcAiGenerateInput, type IpcAiStreamInput } from './input-transform.js';
import type { RelayEnv } from './env.js';
import { listenForOAuthCallback, performOauthTokenExchange } from './auth/index.js';
import { DESKTOP_CALLBACK_TIMEOUT_MS } from '@nimiplatform/shell-core/oauth';
import type { RouteState } from './route/route-state.js';

function createScopedRealm(
  env: RelayEnv,
  accessToken?: string,
): Realm {
  const normalizedAccessToken = String(
    accessToken ?? env.NIMI_ACCESS_TOKEN ?? '',
  ).trim();

  return new Realm({
    baseUrl: env.NIMI_REALM_URL,
    auth: {
      accessToken: normalizedAccessToken,
    },
  });
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

  ipcMain.handle('relay:auth:realm-request', async (_event, payload: {
    method: string;
    path: string;
    body?: unknown;
    accessToken?: string;
  }) => {
    try {
      return await createScopedRealm(env, payload.accessToken).raw.request({
        method: payload.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: payload.path,
        body: payload.body,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:check-email', async (_event, payload: { email: string }) => {
    try {
      return await createScopedRealm(env).services.AuthService.checkEmail({
        email: payload.email,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:password-login', async (_event, payload: {
    identifier: string;
    password: string;
  }) => {
    try {
      return await createScopedRealm(env).services.AuthService.passwordLogin({
        identifier: payload.identifier,
        password: payload.password,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:oauth-login', async (_event, payload: {
    provider: string;
    accessToken: string;
  }) => {
    try {
      return await createScopedRealm(env).services.AuthService.oauthLogin({
        provider: payload.provider as OAuthProvider,
        accessToken: payload.accessToken,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:email-otp-request', async (_event, payload: { email: string }) => {
    try {
      return await createScopedRealm(env).services.AuthService.requestEmailOtp({
        email: payload.email,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:email-otp-verify', async (_event, payload: {
    email: string;
    code: string;
  }) => {
    try {
      return await createScopedRealm(env).services.AuthService.verifyEmailOtp({
        email: payload.email,
        code: payload.code,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:2fa-verify', async (_event, payload: {
    tempToken: string;
    code: string;
  }) => {
    try {
      return await createScopedRealm(env).services.AuthService.verifyTwoFactor({
        tempToken: payload.tempToken,
        code: payload.code,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:wallet-challenge', async (_event, payload: {
    walletAddress: string;
    chainId?: number;
    walletType: string;
  }) => {
    try {
      return await createScopedRealm(env).services.AuthService.walletChallenge({
        walletAddress: payload.walletAddress,
        chainId: payload.chainId,
        walletType: payload.walletType,
      });
    } catch (error) {
      throw normalizeError(error);
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
      return await createScopedRealm(env).services.AuthService.walletLogin({
        walletAddress: payload.walletAddress,
        chainId: payload.chainId,
        nonce: payload.nonce,
        message: payload.message,
        signature: payload.signature,
        walletType: payload.walletType,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:update-password', async (_event, payload: {
    newPassword: string;
    accessToken?: string;
  }) => {
    try {
      await createScopedRealm(env, payload.accessToken).services.AuthService.updatePassword({
        newPassword: payload.newPassword,
      });
      return { success: true };
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:auth:current-user', async (_event, payload?: {
    accessToken?: string;
  }) => {
    try {
      return await createScopedRealm(env, payload?.accessToken).services.MeService.getMe();
    } catch (error) {
      throw normalizeError(error);
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
      throw normalizeError(error);
    }
  });
}

const RELAY_REASON_CODE_MISSING_AGENT_ID = ReasonCode.AI_INPUT_INVALID;

function requireAgentId(input: Record<string, unknown>): void {
  if (!input.agentId || typeof input.agentId !== 'string') {
    throw Object.assign(new Error('agentId is required for agent-scoped IPC calls'), {
      reasonCode: RELAY_REASON_CODE_MISSING_AGENT_ID,
      actionHint: 'Select an agent before using this feature',
    });
  }
}

export function registerIpcHandlers(
  runtime: Runtime,
  realm: Realm,
  getWebContents: () => WebContents | null,
  env: RelayEnv,
  routeState?: RouteState,
): void {
  // ── Config — expose non-secret env defaults to renderer (RL-CORE-003) ─
  ipcMain.handle('relay:config', () => ({
    agentId: env.NIMI_AGENT_ID ?? null,
    worldId: env.NIMI_WORLD_ID ?? null,
  }));

  // ── Health (RL-IPC-002) ──────────────────────────────────────────────
  ipcMain.handle('relay:health', async () => {
    try {
      const result = await runtime.health();
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.reasonCode === 'AUTH_TOKEN_INVALID' || normalized.reasonCode === 'AUTH_DENIED') {
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

  ipcMain.handle('relay:ai:generate', async (_event, input: IpcAiGenerateInput) => {
    requireAgentId(input as unknown as Record<string, unknown>);
    try {
      const textInput = toTextGenerateInput(input);
      const result = await runtime.ai.text.generate(textInput);
      return result;
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:ai:stream:open', async (_event, input: IpcAiStreamInput) => {
    requireAgentId(input as unknown as Record<string, unknown>);
    const wc = getWebContents();
    if (!wc) {
      throw new Error('No renderer available');
    }
    try {
      const textInput = toTextStreamInput(input);
      const stream = await runtime.ai.text.stream(textInput);
      return await openStream('ai', stream.stream, wc);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:ai:stream:cancel', (_event, payload: { streamId: string }) => {
    cancelStream(payload.streamId);
  });

  // ── Media (RL-IPC-007) ──────────────────────────────────────────────

  // TTS
  ipcMain.handle('relay:media:tts:synthesize', async (_event, input: Omit<SpeechSynthesizeInput, 'signal'>) => {
    requireAgentId(input as unknown as Record<string, unknown>);
    try {
      return await runtime.media.tts.synthesize(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:media:tts:voices', async (_event, input: SpeechListVoicesInput) => {
    try {
      return await runtime.media.tts.listVoices(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // STT
  ipcMain.handle('relay:media:stt:transcribe', async (_event, input: Omit<SpeechTranscribeInput, 'signal'>) => {
    try {
      return await runtime.media.stt.transcribe(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // Image
  ipcMain.handle('relay:media:image:generate', async (_event, input: Omit<ImageGenerateInput, 'signal'>) => {
    try {
      return await runtime.media.image.generate(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // Video
  ipcMain.handle('relay:media:video:generate', async (_event, input: Omit<VideoGenerateInput, 'signal'>) => {
    requireAgentId(input as unknown as Record<string, unknown>);
    try {
      return await runtime.media.video.generate(input);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:media:video:job:get', async (_event, payload: { jobId: string }) => {
    try {
      return await runtime.media.jobs.get(payload.jobId);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:media:video:job:artifacts', async (_event, payload: { jobId: string }) => {
    try {
      return await runtime.media.jobs.getArtifacts(payload.jobId);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // Video job subscription — stream protocol (RL-IPC-003)
  ipcMain.handle('relay:media:video:job:subscribe', async (_event, payload: { jobId: string }) => {
    const wc = getWebContents();
    if (!wc) {
      throw new Error('No renderer available');
    }
    try {
      const stream = await runtime.media.jobs.subscribe(payload.jobId);
      return await openStream('videoJob', stream, wc);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:media:video:job:cancel', (_event, payload: { streamId: string }) => {
    cancelStream(payload.streamId);
  });

  // ── Realm Passthrough (RL-IPC-008) ──────────────────────────────────
  ipcMain.handle('relay:realm:request', async (_event, input: {
    agentId?: string;
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) => {
    try {
      return await realm.raw.request({
        method: input.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: input.path,
        body: input.body,
        headers: input.headers,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  });

  // ── Chat Pipeline (RL-PIPE-*) ──────────────────────────────────────
  // These handlers bridge the renderer to the beat-first turn pipeline
  // running in the main process.

  ipcMain.handle('relay:chat:send', async (_event, input: {
    agentId: string;
    text: string;
    sessionId?: string;
  }) => {
    requireAgentId(input as unknown as Record<string, unknown>);
    const wc = getWebContents();
    if (!wc) throw new Error('No renderer available');

    try {
      // Dynamic import to avoid circular dependency at registration time
      const { createRelayAiClient } = await import('./chat-pipeline/relay-ai-client.js');
      const { createMainProcessChatContext } = await import('./chat-pipeline/main-process-context.js');

      // Resolve route from route state for model selection
      const resolvedRoute = routeState?.getResolved() ?? null;
      const aiClient = createRelayAiClient(runtime, resolvedRoute);
      const chatContext = createMainProcessChatContext(wc);

      const { DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS } = await import('./settings/types.js');

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

      // Try full pipeline, fall back to simple streaming
      const sendFlowModule = await import('./chat-pipeline/send-flow.js').catch(() => null);

      if (sendFlowModule) {
        await sendFlowModule.runLocalChatTurnSend({
          context: {
            aiClient,
            inputText: input.text,
            viewerId: 'local-user',
            viewerDisplayName: 'User',
            runtimeMode: undefined,
            routeSnapshot,
            defaultSettings: DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS,
            selectedTarget: null, // TODO: resolve from agentId via realm queries
            selectedSessionId: input.sessionId || '',
            messages: chatContext.messages,
          },
          chatContext,
          setSendPhase: (phase) => chatContext.setSendPhase(phase),
          getCurrentContextKey: () => `${input.agentId}`,
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
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:chat:cancel', (_event, _input: { turnTxnId: string }) => {
    // TODO: wire to AbortController in send-flow
  });

  ipcMain.handle('relay:chat:history', async (_event, input: { agentId: string }) => {
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
    } catch {
      return [];
    }
  });

  ipcMain.handle('relay:chat:clear', async (_event, input: { agentId: string; sessionId: string }) => {
    try {
      const { clearSession } = await import('./session-store/index.js');
      await clearSession(input.sessionId);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:chat:settings:get', async () => {
    try {
      const { loadRelaySettings } = await import('./settings/settings-store.js');
      return await loadRelaySettings();
    } catch {
      return null;
    }
  });

  ipcMain.handle('relay:chat:settings:set', async (_event, patch: Record<string, unknown>) => {
    try {
      const { saveRelaySettings } = await import('./settings/settings-store.js');
      const { normalizeLocalChatSettings } = await import('./settings/types.js');
      const settings = normalizeLocalChatSettings(patch);
      saveRelaySettings(settings);
    } catch (error) {
      throw normalizeError(error);
    }
  });

  ipcMain.handle('relay:chat:proactive:toggle', async (_event, input: { enabled: boolean }) => {
    try {
      const { loadRelaySettings, saveRelaySettings } = await import('./settings/settings-store.js');
      const settings = await loadRelaySettings();
      settings.product.allowProactiveContact = input.enabled;
      saveRelaySettings(settings);
    } catch (error) {
      throw normalizeError(error);
    }
  });
}
