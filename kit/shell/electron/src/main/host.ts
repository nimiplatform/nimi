import { createDefaultRuntimeGrpcBridgeClient } from './grpc-client.js';
import {
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import { isElectronRuntimeAccountCustodyCommand } from './auth.js';
import { resolveElectronAvatarAssetUrl } from './avatar.js';
import { getElectronAiConfig, setElectronAiConfig } from './ai-config.js';
import { resolveElectronAiProfile } from './ai-profile.js';
import { assertElectronHostCommandPolicyAllowed } from './command-policy.js';
import { getElectronRuntimeConfig } from './config.js';
import {
  readElectronStandardStorageJson,
  removeElectronStandardStorageJson,
  resolveElectronStandardDataPath,
  writeElectronStandardStorageJson,
} from './data-storage.js';
import { resolveElectronDiagnosticsRendererEntryProbe, resolveElectronRendererOrigin } from './diagnostics.js';
import {
  assertAllowedElectronRendererOrigin,
  assertAllowedElectronRendererUrl,
  createElectronCapabilityNotInHostSetError,
  createElectronCapabilityPolicyRequiredError,
  createElectronCapabilitySetUnknownError,
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createElectronRuntimeAccountCustodyExternalError,
  createElectronRuntimeEndpointUnavailableError,
  isAllowedElectronRendererOrigin,
  isAllowedElectronRendererUrl,
  normalizeElectronShellAppId,
  toSerializedElectronShellError,
} from './errors.js';
import { writeElectronShellArtifact } from './artifacts.js';
import { bindElectronStandardDataRootRuntimeResolver } from './data-root-binding.js';
import { openElectronDesktopIntent } from './desktop-open.js';
import { saveElectronShellExportFile } from './export.js';
import { openElectronShellFileDialog } from './file-dialog.js';
import { revealElectronShellFile } from './file-reveal.js';
import { dispatchElectronFloatingWindowCommand, isElectronFloatingWindowCommand } from './floating-window.js';
import { resolveElectronStandardLocalAssetUrl } from './local-assets.js';
import {
  assertOpaqueElectronLocalAgentRef,
  resolveElectronLocalAgentIdentity,
  resolveElectronRuntimeTrustedCaller,
} from './local-agent.js';
import { exchangeElectronOauthToken, listenElectronOauthForCode, openElectronExternalUrl } from './oauth.js';
import { resolveElectronPlatformProjection } from './platform-projection.js';
import { confirmElectronShellDialog, focusElectronMainWindow, startElectronWindowDrag } from './shell-ui.js';
import { asRecord, normalizeRequiredToken, normalizeText, standardNestedPayload } from './paths.js';
import {
  createElectronRuntimeBridgeCommandNames,
  createElectronRuntimeBridgeEventName,
  electronRuntimeCommandPayload,
  closeElectronRuntimeStream,
  getElectronStandardShellCapabilityIds,
  invokeElectronRuntimeUnary,
  openElectronRuntimeStream,
  parseElectronRuntimeStreamOpenRequest,
  parseElectronRuntimeUnaryRequest,
  probeElectronRuntimeStatus,
  resolveElectronRuntimeDefaults,
} from './runtime.js';
import { isElectronExternallyManagedRuntimeCommand } from './runtime-lifecycle.js';
import { NimiElectronShellHostError } from './types.js';
import type {
  NimiElectronHostCommandKind,
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
  assertOpaqueElectronLocalAgentRef,
};

const STANDARD_SHELL_COMMAND_SET: ReadonlySet<string> = new Set(
  NIMI_STANDARD_SHELL_CAPABILITIES.flatMap((capability) => capability.operations.map((operation) => operation.command)),
);

type ResolvedElectronStandardShellCapabilitySet = {
  readonly allowAllStandardShellCommands: boolean;
  readonly capabilitySetRef: string;
  readonly allowedCommands: ReadonlySet<string>;
};

function isStandardShellCommand(command: string): boolean {
  return STANDARD_SHELL_COMMAND_SET.has(command);
}

function classifyElectronHostCommand(
  command: string,
  hasCommandHandler: boolean,
): NimiElectronHostCommandKind {
  if (isStandardShellCommand(command)) {
    return 'standard';
  }
  if (hasCommandHandler) {
    return 'app-domain';
  }
  return 'unknown';
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
  const capabilitySet = resolveElectronStandardShellCapabilitySet(input.standardShellHost);
  const createGrpcClient = input.createGrpcClient ?? createDefaultRuntimeGrpcBridgeClient;
  let clientPromise: Promise<RuntimeGrpcBridgeClient> | undefined;
  const ensureClient = () => {
    clientPromise ??= Promise.resolve(createGrpcClient(runtimeEndpoint));
    return clientPromise;
  };
  if (input.standardShellHost?.standardDataRootBinding?.source === 'runtime-get-app-storage') {
    bindElectronStandardDataRootRuntimeResolver(input.standardShellHost, {
      appId,
      runtimeEndpoint,
      ensureClient,
    });
  }
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
    const commandHandler = input.commandHandlers?.[command];
    const commandKind = classifyElectronHostCommand(command, Boolean(commandHandler));
    await assertElectronHostCommandPolicyAllowed(input.commandPolicy, { command, commandKind, appId });
    assertElectronStandardShellCommandAllowed(command, commandKind, capabilitySet, appId, Boolean(input.standardShellHost));
    if (command === commandNames.unary) {
      const runtimePayload = electronRuntimeCommandPayload(payload, command);
      parseElectronRuntimeUnaryRequest(runtimePayload);
      return invokeElectronRuntimeUnary({
        client: await ensureClient(),
        payload: runtimePayload,
        appId,
        event,
        runtimeEndpoint,
        command,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
      });
    }
    if (command === commandNames.stream_open) {
      const runtimePayload = electronRuntimeCommandPayload(payload, command);
      parseElectronRuntimeStreamOpenRequest(runtimePayload);
      return openElectronRuntimeStream({
        client: await ensureClient(),
        payload: runtimePayload,
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
        return await probeElectronRuntimeStatus({ client: await ensureClient(), appId, runtimeEndpoint, command });
      } catch (error) {
        if (error instanceof NimiElectronShellHostError) {
          throw error;
        }
        throw createElectronRuntimeEndpointUnavailableError(command, runtimeEndpoint, error);
      }
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get']) return resolveElectronRuntimeDefaults();
    if (command === NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe']) return resolveElectronDiagnosticsRendererEntryProbe({ event, payload, appId });
    if (command === commandNames.config_get) return getElectronRuntimeConfig(input.standardShellHost, command);
    if (isElectronExternallyManagedRuntimeCommand(command, commandNames)) throw createElectronExternalDaemonRequiredError(command);
    const standardPayload = standardNestedPayload(payload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']) return resolveElectronStandardDataPath(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']) return readElectronStandardStorageJson(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']) return writeElectronStandardStorageJson(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']) return removeElectronStandardStorageJson(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']) return openElectronExternalUrl(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange']) return exchangeElectronOauthToken(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode']) return listenElectronOauthForCode(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']) return openElectronDesktopIntent({ host: input.standardShellHost, payload: standardPayload, command, appId });
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']) {
      return confirmElectronShellDialog({ host: input.standardShellHost, payload: standardPayload, command, event, appId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag']) {
      return startElectronWindowDrag({ host: input.standardShellHost, command, event, appId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow']) {
      return focusElectronMainWindow({ host: input.standardShellHost, command, event, appId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']) return resolveElectronStandardLocalAssetUrl(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']) return openElectronShellFileDialog(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) return revealElectronShellFile(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']) return saveElectronShellExportFile(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']) return writeElectronShellArtifact(input.standardShellHost, standardPayload, command);
    if (isElectronFloatingWindowCommand(command)) {
      return dispatchElectronFloatingWindowCommand({ host: input.standardShellHost, payload: standardPayload, command, event, appId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve']) return resolveElectronAvatarAssetUrl(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity']) return resolveElectronLocalAgentIdentity(input.standardShellHost, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']) return resolveElectronRuntimeTrustedCaller(input.standardShellHost, standardPayload, appId, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get']) return resolveElectronAiProfile(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']) return resolveElectronPlatformProjection(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']) return getElectronAiConfig(input.standardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']) return setElectronAiConfig(input.standardShellHost, standardPayload, command);
    if (isElectronRuntimeAccountCustodyCommand(command)) throw createElectronRuntimeAccountCustodyExternalError(command);
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

function resolveElectronStandardShellCapabilitySet(
  standardShellHost: RegisterNimiElectronRuntimeBridgeInput['standardShellHost'],
): ResolvedElectronStandardShellCapabilitySet | undefined {
  if (standardShellHost?.allowAllStandardShellCommands) {
    return {
      allowAllStandardShellCommands: true,
      capabilitySetRef: 'electron-full-standard-shell-explicit',
      allowedCommands: STANDARD_SHELL_COMMAND_SET,
    };
  }
  const normalized = normalizeText(standardShellHost?.capabilitySetRef);
  if (!normalized) {
    return undefined;
  }
  const capabilitySet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find((entry) => entry.setId === normalized);
  if (!capabilitySet) {
    throw createElectronCapabilitySetUnknownError(normalized);
  }
  return {
    allowAllStandardShellCommands: false,
    capabilitySetRef: normalized,
    allowedCommands: new Set(capabilitySet.allowedCommands),
  };
}

function assertElectronStandardShellCommandAllowed(
  command: string,
  commandKind: NimiElectronHostCommandKind,
  capabilitySet: ResolvedElectronStandardShellCapabilitySet | undefined,
  appId: string,
  hasStandardShellHost: boolean,
): void {
  if (commandKind !== 'standard') {
    return;
  }
  if (!capabilitySet) {
    if (!hasStandardShellHost) {
      return;
    }
    throw createElectronCapabilityPolicyRequiredError(command, appId);
  }
  if (capabilitySet.allowAllStandardShellCommands || capabilitySet.allowedCommands.has(command)) {
    return;
  }
  throw createElectronCapabilityNotInHostSetError(command, capabilitySet.capabilitySetRef);
}
