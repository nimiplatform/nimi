import { setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/transports/node-grpc';
import type { RuntimeClientConfig } from '../../src/runtime/types';
import {
  AuthorizationPreset,
  PolicyMode,
} from '../../src/runtime/generated/runtime/v1/grant';
import { ExternalPrincipalType } from '../../src/runtime/generated/runtime/v1/common';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp';
import {
  FallbackPolicy,
  type ExecuteScenarioRequest,
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
  type StreamScenarioRequest,
} from '../../src/runtime/generated/runtime/v1/ai';

export const APP_ID = 'nimi.desktop.test';

export const runtimeConfig: RuntimeClientConfig = {
  appId: APP_ID,
  transport: {
    type: 'node-grpc',
    endpoint: '127.0.0.1:46371',
  },
};

export function createGenerateRequest(): ExecuteScenarioRequest {
  return {
    head: {
      appId: APP_ID,
      subjectUserId: 'mod:local-chat',
      modelId: 'local-model',
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 0,
      connectorId: '',
    },
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.SYNC,
    spec: {
      spec: {
        oneofKind: 'textGenerate',
        textGenerate: {
          input: [
            {
              role: 'user',
              content: 'hello',
              name: '',
            },
          ],
          systemPrompt: '',
          tools: [],
          temperature: 0,
          topP: 0,
          maxTokens: 128,
        },
      },
    },
    extensions: [],
  };
}

export function createStreamGenerateRequest(): StreamScenarioRequest {
  const request = createGenerateRequest();
  return {
    head: request.head,
    scenarioType: request.scenarioType,
    executionMode: ExecutionMode.STREAM,
    spec: request.spec,
    extensions: request.extensions,
  };
}

export function createAuthorizeRequest() {
  return {
    domain: 'app-auth',
    appId: APP_ID,
    externalPrincipalId: 'external-app-1',
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId: 'user-1',
    consentId: 'consent-1',
    consentVersion: '1.0',
    decisionAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
    policyVersion: '1.0.0',
    policyMode: PolicyMode.PRESET,
    preset: AuthorizationPreset.READ_ONLY,
    scopes: ['app.nimi.desktop.test.chat.read'],
    resourceSelectors: undefined,
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: 3600,
    scopeCatalogVersion: '1.0.0',
    policyOverride: false,
  };
}

export function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

export function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

export type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
export type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void> | (() => void);

export type TauriRuntime = {
  core: { invoke: TauriInvoke };
  event: { listen: TauriListen };
};

type MutableGlobalTauri = typeof globalThis & {
  __TAURI__?: TauriRuntime;
  window?: { __TAURI__?: TauriRuntime };
};

export function installTauriRuntime(runtime: TauriRuntime): () => void {
  const target = globalThis as MutableGlobalTauri;
  const previousRoot = target.__TAURI__;
  const previousWindow = target.window;
  const windowObject = previousWindow || {};

  windowObject.__TAURI__ = runtime;
  target.__TAURI__ = runtime;
  target.window = windowObject;

  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = previousRoot;
    }

    if (typeof previousWindow === 'undefined') {
      delete target.window;
    } else {
      target.window = previousWindow;
    }
  };
}

export function unwrapTauriInvokePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const root = payload as Record<string, unknown>;
  const nested = root.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return {};
  }
  return nested as Record<string, unknown>;
}
