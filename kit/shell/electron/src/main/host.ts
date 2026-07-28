import { createDefaultRuntimeGrpcBridgeClient } from './grpc-client.js';
import {
  rendererOriginFromUrl,
  rendererUrlsEqualExact,
  resolveBundledAvatarRendererUrl,
} from './bundled-avatar-sender.js';
import { createNimiElectronDesktopControlHost } from './desktop-control-host.js';
import { createNimiElectronDesktopAccountHost, isElectronDesktopAccountCommand } from './desktop-account-host.js';
import {
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
} from '@nimiplatform/kit/shell/capabilities';
import { resolveElectronAvatarAssetUrl } from './avatar.js';
import { getElectronAiConfig, setElectronAiConfig } from './ai-config.js';
import { dispatchElectronAgentCenterCommand, isElectronAgentCenterCommand } from './agent-center.js';
import { resolveElectronAiProfile } from './ai-profile.js';
import { assertElectronHostCommandPolicyAllowed } from './command-policy.js';
import {
  readElectronStandardStorageJson,
  removeElectronStandardStorageJson,
  resolveElectronStandardDataPath,
  writeElectronStandardStorageJson,
} from './data-storage.js';
import { resolveElectronDiagnosticsRendererEntryProbe, resolveElectronRendererOrigin } from './diagnostics.js';
import {
  createNimiElectronDeveloperModeHost,
  isElectronDeveloperModeCommand,
} from './developer-mode-host.js';
import {
  assertAllowedElectronRendererOrigin,
  assertAllowedElectronRendererUrl,
  createElectronCapabilityNotInHostSetError,
  createElectronCapabilityPolicyRequiredError,
  createElectronCapabilitySetUnknownError,
  createElectronCapabilityUnavailableError,
  createElectronExternalDaemonRequiredError,
  createElectronRuntimeEndpointUnavailableError,
  isAllowedElectronRendererOrigin,
  isAllowedElectronRendererUrl,
  normalizeElectronShellAppId,
  toSerializedElectronShellError,
} from './errors.js';
import { writeElectronShellArtifact } from './artifacts.js';
import { dispatchElectronLocalAppCommand, isElectronLocalAppCommand } from './local-app-commands.js';
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
import { createNimiElectronFixedRuntimeLifecycleHost } from './runtime-lifecycle-host.js';
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

const LOCAL_APP_EXPLICITLY_FORBIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  'nimi.shell.auth.sessionLoad',
  'nimi.shell.auth.sessionSave',
  'nimi.shell.auth.sessionClear',
  'nimi.shell.desktopPrivate.productControl',
  'nimi.shell.electron.rawIpc',
  'nimi.shell.node.rawFs',
]);

type ResolvedElectronStandardShellCapabilitySet = {
  readonly allowAllStandardShellCommands: boolean;
  readonly capabilitySetRef: string;
  readonly allowedCommands: ReadonlySet<string>;
};

type ResolvedElectronRendererProfile = {
  readonly appId: string;
  readonly bundledAvatarProfile: boolean;
  readonly desktopSenderAuthorized: boolean;
  readonly capabilitySet: ResolvedElectronStandardShellCapabilitySet | undefined;
  readonly standardShellHost: RegisterNimiElectronRuntimeBridgeInput['standardShellHost'];
  readonly commandPolicy: RegisterNimiElectronRuntimeBridgeInput['commandPolicy'];
  readonly commandHandlers: RegisterNimiElectronRuntimeBridgeInput['commandHandlers'];
  readonly streams: Map<string, RuntimeGrpcBridgeStream>;
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
  if (hasCommandHandler
    || isElectronDesktopAccountCommand(command)
    || isElectronDeveloperModeCommand(command)) {
    return 'app-domain';
  }
  return 'unknown';
}

export function registerNimiElectronRuntimeBridge(
  input: RegisterNimiElectronRuntimeBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  const appId = normalizeElectronShellAppId(input.appId);
  const runtimeEndpoint = normalizeRequiredToken(input.runtimeEndpoint, 'runtimeEndpoint');
  const baseAllowedOrigins = input.allowedOrigins.map((origin) => normalizeText(origin)).filter(Boolean);
  const allowedRendererUrls = input.allowedRendererUrls?.map((url) => normalizeText(url)).filter(Boolean) ?? [];
  if (baseAllowedOrigins.length === 0) {
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
  const bundledAvatarRendererUrl = resolveBundledAvatarRendererUrl(input, appId, allowedRendererUrls);
  const bundledAvatarCapabilitySet = resolveElectronStandardShellCapabilitySet(
    input.bundledAvatarHost?.standardShellHost,
  );
  const allowedOrigins = bundledAvatarRendererUrl
    ? [...new Set([...baseAllowedOrigins, rendererOriginFromUrl(bundledAvatarRendererUrl)])]
    : baseAllowedOrigins;
  const createGrpcClient = input.createGrpcClient ?? createDefaultRuntimeGrpcBridgeClient;
  const desktopControlHost = appId === 'nimi.desktop'
    ? createNimiElectronDesktopControlHost()
    : undefined;
  const desktopAccountHost = appId === 'nimi.desktop'
    ? createNimiElectronDesktopAccountHost()
    : undefined;
  const fixedRuntimeLifecycleHost = appId === 'nimi.desktop'
    ? createNimiElectronFixedRuntimeLifecycleHost(runtimeEndpoint)
    : undefined;
  const developerModeHost = appId === 'nimi.desktop'
    ? createNimiElectronDeveloperModeHost()
    : undefined;
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
      trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
    });
  }
  if (input.bundledAvatarHost?.standardShellHost?.standardDataRootBinding?.source === 'runtime-get-app-storage') {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Bundled Avatar app-private storage cannot use the generic Runtime app-storage resolver',
      reasonCode: 'electron-bundled-avatar-runtime-storage-binding-forbidden',
      actionHint: 'use_desktop_owned_avatar_app_private_storage_root',
    });
  }
  const desktopStreams = new Map<string, RuntimeGrpcBridgeStream>();
  const bundledAvatarStreamsBySender = new Map<object, Map<string, RuntimeGrpcBridgeStream>>();
  const bundledAvatarStreamsFor = (sender: object): Map<string, RuntimeGrpcBridgeStream> => {
    let streams = bundledAvatarStreamsBySender.get(sender);
    if (!streams) {
      streams = new Map();
      bundledAvatarStreamsBySender.set(sender, streams);
    }
    return streams;
  };
  const unsubscribeDesktopInvalidation = input.desktopHost?.subscribeSenderInvalidation(() => {
    for (const stream of desktopStreams.values()) stream.cancel();
    desktopStreams.clear();
  });
  const unsubscribeBundledAvatarInvalidation = input.bundledAvatarHost?.subscribeSenderInvalidation((sender) => {
    const streams = bundledAvatarStreamsBySender.get(sender);
    for (const stream of streams?.values() ?? []) stream.cancel();
    streams?.clear();
    bundledAvatarStreamsBySender.delete(sender);
  });

  const resolveRendererProfile = (event: NimiElectronIpcMainInvokeEvent): ResolvedElectronRendererProfile => {
    const rendererUrl = normalizeText(event.senderFrame?.url);
    const bundledSenderAuthorized = input.bundledAvatarHost?.authorizeSender(event) === true;
    if (bundledSenderAuthorized) {
      if (!bundledAvatarRendererUrl || !rendererUrlsEqualExact(rendererUrl, bundledAvatarRendererUrl)) {
        throw new NimiElectronShellHostError({
          code: 'protected-carrier-required',
          message: 'Bundled Avatar sender navigation integrity check failed',
          reasonCode: 'electron-bundled-avatar-navigation-integrity-failed',
          actionHint: 'close_and_reopen_supervised_avatar_window',
        });
      }
      return {
        appId: 'nimi.avatar',
        bundledAvatarProfile: true,
        desktopSenderAuthorized: false,
        capabilitySet: bundledAvatarCapabilitySet,
        standardShellHost: input.bundledAvatarHost?.standardShellHost,
        commandPolicy: input.bundledAvatarHost?.commandPolicy,
        commandHandlers: input.bundledAvatarHost?.commandHandlers,
        streams: bundledAvatarStreamsFor(event.sender as object),
      };
    }
    assertAllowedElectronRendererUrl({ url: rendererUrl, allowedUrls: allowedRendererUrls });
    return {
      appId,
      bundledAvatarProfile: false,
      desktopSenderAuthorized: input.desktopHost?.authorizeSender(event) === true,
      capabilitySet,
      standardShellHost: input.standardShellHost,
      commandPolicy: input.commandPolicy,
      commandHandlers: input.commandHandlers,
      streams: desktopStreams,
    };
  };

  const handleInvoke = async (event: NimiElectronIpcMainInvokeEvent, message: unknown): Promise<unknown> => {
    assertAllowedElectronRendererOrigin({
      origin: resolveElectronRendererOrigin(event),
      allowedOrigins,
    });
    const rendererProfile = resolveRendererProfile(event);
    const effectiveAppId = rendererProfile.appId;
    const effectiveStandardShellHost = rendererProfile.standardShellHost;
    const envelope = asRecord(message, 'Electron Runtime bridge message must be an object');
    const command = normalizeRequiredToken(envelope.command, 'command');
    const payload = asRecord(envelope.payload ?? {}, 'Electron Runtime bridge command ' + command + ' payload must be an object');
    const commandHandler = rendererProfile.commandHandlers?.[command];
    const commandKind = classifyElectronHostCommand(command, Boolean(commandHandler));
    await assertElectronHostCommandPolicyAllowed(rendererProfile.commandPolicy, { command, commandKind, appId: effectiveAppId });
    assertElectronStandardShellCommandAllowed(command, commandKind, rendererProfile.capabilitySet, effectiveAppId, Boolean(effectiveStandardShellHost));
    if (command === commandNames.unary) {
      const runtimePayload = electronRuntimeCommandPayload(payload, command);
      parseElectronRuntimeUnaryRequest(runtimePayload);
      return invokeElectronRuntimeUnary({
        client: desktopControlHost ? undefined : await ensureClient(),
        payload: runtimePayload,
        appId: effectiveAppId,
        event,
        runtimeEndpoint,
        command,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
        desktopControlHost,
        desktopSenderAuthorized: rendererProfile.desktopSenderAuthorized,
        bundledAvatarProfile: rendererProfile.bundledAvatarProfile,
      });
    }
    if (command === commandNames.stream_open) {
      const runtimePayload = electronRuntimeCommandPayload(payload, command);
      parseElectronRuntimeStreamOpenRequest(runtimePayload);
      return openElectronRuntimeStream({
        client: desktopControlHost ? undefined : await ensureClient(),
        payload: runtimePayload,
        appId: effectiveAppId,
        runtimeEndpoint,
        command,
        event,
        eventNamespace,
        eventChannelPrefix,
        streams: rendererProfile.streams,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
        desktopProtectedOnly: Boolean(desktopControlHost),
        desktopControlHost,
        desktopSenderAuthorized: rendererProfile.desktopSenderAuthorized,
        bundledAvatarProfile: rendererProfile.bundledAvatarProfile,
      });
    }
    if (command === commandNames.stream_close) {
      return closeElectronRuntimeStream(electronRuntimeCommandPayload(payload, command), rendererProfile.streams);
    }
    if (command === commandNames.status) {
      if (fixedRuntimeLifecycleHost) {
        return fixedRuntimeLifecycleHost.invoke(command, commandNames);
      }
      try {
        return await probeElectronRuntimeStatus({ client: await ensureClient(), appId: effectiveAppId, runtimeEndpoint, command });
      } catch (error) {
        if (error instanceof NimiElectronShellHostError) {
          throw error;
        }
        throw createElectronRuntimeEndpointUnavailableError(command, runtimeEndpoint, error);
      }
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get']) {
      return resolveElectronRuntimeDefaults(input.runtimeDeploymentProfile);
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe']) return resolveElectronDiagnosticsRendererEntryProbe({ event, payload, appId: effectiveAppId });
    if (isElectronExternallyManagedRuntimeCommand(command, commandNames)) {
      if (fixedRuntimeLifecycleHost) {
        return fixedRuntimeLifecycleHost.invoke(command, commandNames);
      }
      throw createElectronExternalDaemonRequiredError(command);
    }
    const standardPayload = standardNestedPayload(payload, command);
    if (effectiveStandardShellHost?.localAppHost && isElectronLocalAppCommand(command)) {
      return dispatchElectronLocalAppCommand({
        host: effectiveStandardShellHost.localAppHost,
        payload: standardPayload,
        command,
        sendEvent: event.sender?.send
          ? (eventName, eventPayload) => event.sender?.send?.(`${eventChannelPrefix}${eventName}`, eventPayload)
          : undefined,
      });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']) return resolveElectronStandardDataPath(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']) return readElectronStandardStorageJson(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']) return writeElectronStandardStorageJson(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']) return removeElectronStandardStorageJson(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']) return openElectronExternalUrl(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange']) return exchangeElectronOauthToken(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode']) return listenElectronOauthForCode(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']) return openElectronDesktopIntent({ host: effectiveStandardShellHost, payload: standardPayload, command, appId: effectiveAppId });
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']) {
      return confirmElectronShellDialog({ host: effectiveStandardShellHost, payload: standardPayload, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag']) {
      return startElectronWindowDrag({ host: effectiveStandardShellHost, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow']) {
      return focusElectronMainWindow({ host: effectiveStandardShellHost, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']) return resolveElectronStandardLocalAssetUrl(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']) return openElectronShellFileDialog(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) return revealElectronShellFile(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']) return saveElectronShellExportFile(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']) return writeElectronShellArtifact(effectiveStandardShellHost, standardPayload, command);
    if (isElectronLocalAppCommand(command)) {
      return dispatchElectronLocalAppCommand({
        host: effectiveStandardShellHost?.localAppHost,
        payload: standardPayload,
        command,
        sendEvent: event.sender?.send
          ? (eventName, eventPayload) => event.sender?.send?.(`${eventChannelPrefix}${eventName}`, eventPayload)
          : undefined,
      });
    }
    if (isElectronAgentCenterCommand(command)) {
      return dispatchElectronAgentCenterCommand({ host: effectiveStandardShellHost, payload: standardPayload, command });
    }
    if (isElectronFloatingWindowCommand(command)) {
      return dispatchElectronFloatingWindowCommand({ host: effectiveStandardShellHost, payload: standardPayload, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve']) return resolveElectronAvatarAssetUrl(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity']) return resolveElectronLocalAgentIdentity(effectiveStandardShellHost, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']) return resolveElectronRuntimeTrustedCaller(effectiveStandardShellHost, standardPayload, effectiveAppId, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get']) return resolveElectronAiProfile(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']) return resolveElectronPlatformProjection(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']) return getElectronAiConfig(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']) return setElectronAiConfig(effectiveStandardShellHost, standardPayload, command);
    if (!rendererProfile.bundledAvatarProfile && desktopAccountHost && isElectronDesktopAccountCommand(command)) {
      return desktopAccountHost.invoke(command, payload, {
        eventChannelPrefix,
        sender: event.sender,
      });
    }
    if (!rendererProfile.bundledAvatarProfile && developerModeHost && isElectronDeveloperModeCommand(command)) {
      return developerModeHost.invoke(command, payload);
    }
    if (commandHandler) return await commandHandler({ command, payload, event, appId: effectiveAppId, runtimeEndpoint });
    if (isStandardShellCommand(command)) throw createElectronCapabilityUnavailableError(command);
    if (
      rendererProfile.capabilitySet?.capabilitySetRef === NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID
      && (
        LOCAL_APP_EXPLICITLY_FORBIDDEN_COMMANDS.has(command)
        || String(command).startsWith('nimi.shell.localApp.')
      )
    ) {
      throw createElectronCapabilityNotInHostSetError(command, rendererProfile.capabilitySet.capabilitySetRef);
    }
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
      for (const stream of desktopStreams.values()) stream.cancel();
      for (const streams of bundledAvatarStreamsBySender.values()) {
        for (const stream of streams.values()) stream.cancel();
        streams.clear();
      }
      desktopStreams.clear();
      bundledAvatarStreamsBySender.clear();
      unsubscribeDesktopInvalidation?.();
      unsubscribeBundledAvatarInvalidation?.();
      desktopAccountHost?.close();
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
