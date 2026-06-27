import { createDefaultRuntimeGrpcBridgeClient } from './grpc-client.js';
import { NIMI_STANDARD_SHELL_CAPABILITIES, NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { isElectronRuntimeAccountCustodyCommand } from './auth.js';
import { resolveElectronAvatarAssetUrl } from './avatar.js';
import { getElectronAiConfig, setElectronAiConfig } from './ai-config.js';
import { resolveElectronAiProfile } from './ai-profile.js';
import { getElectronRuntimeConfig } from './config.js';
import { readElectronStandardStorageJson, resolveElectronStandardDataPath, writeElectronStandardStorageJson } from './data-storage.js';
import { resolveElectronDiagnosticsRendererEntryProbe, resolveElectronRendererOrigin } from './diagnostics.js';
import {
  assertAllowedElectronRendererOrigin,
  assertAllowedElectronRendererUrl,
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createElectronRuntimeAccountCustodyExternalError,
  createElectronRuntimeEndpointUnavailableError,
  isAllowedElectronRendererOrigin,
  isAllowedElectronRendererUrl,
  normalizeElectronShellAppId,
  toSerializedElectronShellError,
} from './errors.js';
import { resolveElectronStandardLocalAssetUrl } from './local-assets.js';
import { resolveElectronLocalAgentIdentity, resolveElectronRuntimeTrustedCaller } from './local-agent.js';
import { exchangeElectronOauthToken, listenElectronOauthForCode, openElectronExternalUrl } from './oauth.js';
import { resolveElectronPlatformProjection } from './platform-projection.js';
import { asRecord, normalizeRequiredToken, normalizeText } from './paths.js';
import {
  createElectronRuntimeBridgeCommandNames,
  createElectronRuntimeBridgeEventName,
  electronRuntimeCommandPayload,
  closeElectronRuntimeStream,
  getElectronStandardShellCapabilityIds,
  invokeElectronRuntimeUnary,
  openElectronRuntimeStream,
  probeElectronRuntimeStatus,
  electronRuntimeUnavailableStatus,
  resolveElectronRuntimeDefaults,
} from './runtime.js';
import { isElectronExternallyManagedRuntimeCommand } from './runtime-lifecycle.js';
import { NimiElectronShellHostError } from './types.js';
import type {
  NimiElectronIpcMainInvokeEvent,
  RegisterNimiElectronRuntimeBridgeInput,
  RegisteredNimiElectronRuntimeBridge,
  RuntimeGrpcBridgeClient,
  RuntimeGrpcBridgeStream,
} from './types.js';

export * from './types.js';
export {
  assertAllowedElectronRendererOrigin,
  assertAllowedElectronRendererUrl,
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createElectronRuntimeBridgeCommandNames,
  createElectronRuntimeBridgeEventName,
  createElectronRuntimeEndpointUnavailableError,
  getElectronStandardShellCapabilityIds,
  isAllowedElectronRendererOrigin,
  isAllowedElectronRendererUrl,
  normalizeElectronShellAppId,
};

const STANDARD_SHELL_COMMAND_SET: ReadonlySet<string> = new Set(
  NIMI_STANDARD_SHELL_CAPABILITIES.flatMap((capability) => capability.operations.map((operation) => operation.command)),
);

function isStandardShellCommand(command: string): boolean {
  return STANDARD_SHELL_COMMAND_SET.has(command);
}

export function registerNimiElectronRuntimeBridge(
  input: RegisterNimiElectronRuntimeBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  const appId = normalizeElectronShellAppId(input.appId);
  const runtimeEndpoint = normalizeRequiredToken(input.runtimeEndpoint, 'runtimeEndpoint');
  const allowedOrigins = input.allowedOrigins.map((origin) => normalizeText(origin)).filter(Boolean);
  const allowedRendererUrls = input.allowedRendererUrls?.map((url) => normalizeText(url)).filter(Boolean) ?? [];
  if (allowedOrigins.length === 0) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Electron shell host requires at least one allowed renderer origin',
      reasonCode: 'electron-renderer-origin-allowlist-required',
      actionHint: 'provide_renderer_origin_allowlist',
    });
  }
  const commandNames = createElectronRuntimeBridgeCommandNames(input.commandNamespace);
  const eventNamespace = normalizeText(input.eventNamespace) || 'nimi.shell.runtime';
  const invokeChannel = normalizeText(input.invokeChannel) || 'nimi:runtime:invoke';
  const eventChannelPrefix = normalizeText(input.eventChannelPrefix) || 'nimi:runtime:event:';
  const createGrpcClient = input.createGrpcClient ?? createDefaultRuntimeGrpcBridgeClient;
  let clientPromise: Promise<RuntimeGrpcBridgeClient> | undefined;
  const ensureClient = () => {
    clientPromise ??= Promise.resolve(createGrpcClient(runtimeEndpoint));
    return clientPromise;
  };
  const streams = new Map<string, RuntimeGrpcBridgeStream>();

  const handleInvoke = async (event: NimiElectronIpcMainInvokeEvent, message: unknown): Promise<unknown> => {
    assertAllowedElectronRendererOrigin({
      origin: resolveElectronRendererOrigin(event),
      allowedOrigins,
    });
    assertAllowedElectronRendererUrl({
      url: event.senderFrame?.url,
      allowedUrls: allowedRendererUrls,
    });
    const envelope = asRecord(message, 'Electron Runtime bridge message must be an object');
    const command = normalizeRequiredToken(envelope.command, 'command');
    const payload = asRecord(envelope.payload ?? {}, 'Electron Runtime bridge command ' + command + ' payload must be an object');
    if (command === commandNames.unary) {
      return invokeElectronRuntimeUnary({
        client: await ensureClient(),
        payload: electronRuntimeCommandPayload(payload, command),
        appId,
        event,
        runtimeEndpoint,
        command,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
      });
    }
    if (command === commandNames.stream_open) {
      return openElectronRuntimeStream({
        client: await ensureClient(),
        payload: electronRuntimeCommandPayload(payload, command),
        appId,
        runtimeEndpoint,
        command,
        event,
        eventNamespace,
        eventChannelPrefix,
        streams,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
      });
    }
    if (command === commandNames.stream_close) {
      return closeElectronRuntimeStream(electronRuntimeCommandPayload(payload, command), streams);
    }
    if (command === commandNames.status) {
      try {
        return await probeElectronRuntimeStatus({ client: await ensureClient(), appId, runtimeEndpoint });
      } catch (error) {
        return electronRuntimeUnavailableStatus(runtimeEndpoint, error);
      }
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get']) return resolveElectronRuntimeDefaults();
    if (command === NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe']) return resolveElectronDiagnosticsRendererEntryProbe({ event, payload, appId });
    if (command === commandNames.config_get) return getElectronRuntimeConfig(input.standardShellHost, command);
    if (isElectronExternallyManagedRuntimeCommand(command, commandNames)) throw createElectronExternalDaemonRequiredError(command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']) return resolveElectronStandardDataPath(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']) return readElectronStandardStorageJson(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']) return writeElectronStandardStorageJson(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']) return openElectronExternalUrl(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange']) return exchangeElectronOauthToken(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode']) return listenElectronOauthForCode(payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']) return resolveElectronStandardLocalAssetUrl(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve']) return resolveElectronAvatarAssetUrl(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity']) return resolveElectronLocalAgentIdentity(input.standardShellHost, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']) return resolveElectronRuntimeTrustedCaller(input.standardShellHost, payload, appId, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get']) return resolveElectronAiProfile(payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']) return resolveElectronPlatformProjection(payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']) return getElectronAiConfig(input.standardShellHost, payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']) return setElectronAiConfig(input.standardShellHost, payload, command);
    if (isElectronRuntimeAccountCustodyCommand(command)) throw createElectronRuntimeAccountCustodyExternalError(command);
    const commandHandler = input.commandHandlers?.[command];
    if (commandHandler) return await commandHandler({ command, payload, event, appId, runtimeEndpoint });
    if (isStandardShellCommand(command)) throw createElectronCapabilityUnavailableError(command);
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Unsupported Electron Runtime bridge command: ' + command,
      reasonCode: 'unsupported-electron-shell-command',
      actionHint: 'use_registered_runtime_bridge_command',
      details: { command },
    });
  };

  input.ipcMain.handle(invokeChannel, async (event, message) => {
    try {
      return { ok: true, value: await handleInvoke(event, message) };
    } catch (error) {
      return { ok: false, error: toSerializedElectronShellError(error) };
    }
  });

  return {
    invokeChannel,
    unregister: () => {
      input.ipcMain.removeHandler?.(invokeChannel);
      for (const stream of streams.values()) {
        stream.cancel();
      }
      streams.clear();
      void clientPromise?.then((client) => client.close()).catch(() => undefined);
    },
  };
}
