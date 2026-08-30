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
import {
  dispatchElectronLocalAppAssetMediaCommand,
  isElectronLocalAppAssetMediaCommand,
} from './app-asset-protocol.js';
import { bindElectronStandardDataRootRuntimeResolver } from './data-root-binding.js';
import { openElectronDesktopIntent } from './desktop-open.js';
import { createNimiElectronFormalAppLocalHost } from './formal-app-local-host.js';
import { saveElectronShellExportFile } from './export.js';
import { openElectronShellFileDialog } from './file-dialog.js';
import { revealElectronShellFile } from './file-reveal.js';
import { dispatchElectronFloatingWindowCommand, isElectronFloatingWindowCommand } from './floating-window.js';
import { resolveElectronStandardLocalAssetUrl } from './local-assets.js';
import { listenElectronOauthForCode, openElectronExternalUrl } from './oauth.js';
import { resolveElectronPlatformProjection } from './platform-projection.js';
import { confirmElectronShellDialog, focusElectronMainWindow, startElectronWindowDrag } from './shell-ui.js';
import { handoffElectronAvatarHost } from './avatar-host-handoff.js';
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
  parseElectronRuntimeUnaryCancelRequest,
  parseElectronRuntimeUnaryRequest,
  probeElectronRuntimeStatus,
  resolveElectronRuntimeDefaults,
} from './runtime.js';
import { isElectronExternallyManagedRuntimeCommand } from './runtime-lifecycle.js';
import { createNimiElectronRuntimeLifecycleHost } from './runtime-lifecycle-host.js';
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
  readonly unaries: Map<string, ActiveRuntimeUnary>;
};

type ActiveRuntimeUnary = {
  readonly controller: AbortController;
  readonly completion: Promise<void>;
};

function isStandardShellCommand(command: string): boolean {
  return STANDARD_SHELL_COMMAND_SET.has(command);
}

function classifyElectronHostCommand(
  command: string,
  hasCommandHandler: boolean,
): NimiElectronHostCommandKind {
  if (isStandardShellCommand(command) || isElectronLocalAppCommand(command)) {
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
  const desktopControlHost = appId === 'nimi.desktop'
    ? createNimiElectronDesktopControlHost()
    : undefined;
  const standardShellHost = desktopControlHost && input.standardShellHost
    ? {
        ...input.standardShellHost,
        localAppHost: createNimiElectronFormalAppLocalHost({
          appId: 'nimi.desktop', profile: 'desktop', control: desktopControlHost,
          revealInOs: input.standardShellHost.revealInOs,
        }),
      }
    : input.standardShellHost;
  const bundledAvatarStandardShellHost = desktopControlHost && input.bundledAvatarHost
    ? {
        ...input.bundledAvatarHost.standardShellHost,
        localAppHost: createNimiElectronFormalAppLocalHost({
          appId: 'nimi.avatar', profile: 'avatar', control: desktopControlHost,
          revealInOs: input.bundledAvatarHost.standardShellHost?.revealInOs,
        }),
      }
    : input.bundledAvatarHost?.standardShellHost;
  const capabilitySet = resolveElectronStandardShellCapabilitySet(standardShellHost);
  const bundledAvatarRendererUrl = resolveBundledAvatarRendererUrl(input, appId, allowedRendererUrls);
  const bundledAvatarCapabilitySet = resolveElectronStandardShellCapabilitySet(
    bundledAvatarStandardShellHost,
  );
  const allowedOrigins = bundledAvatarRendererUrl
    ? [...new Set([...baseAllowedOrigins, rendererOriginFromUrl(bundledAvatarRendererUrl)])]
    : baseAllowedOrigins;
  const createGrpcClient = input.createGrpcClient ?? createDefaultRuntimeGrpcBridgeClient;
  const desktopAccountHost = appId === 'nimi.desktop'
    ? createNimiElectronDesktopAccountHost()
    : undefined;
  const runtimeLifecycleHost = appId === 'nimi.desktop'
    ? createNimiElectronRuntimeLifecycleHost(
        runtimeEndpoint,
        input.runtimeLifecycleProfile ?? 'fixed',
      )
    : undefined;
  const developerModeHost = appId === 'nimi.desktop'
    ? createNimiElectronDeveloperModeHost()
    : undefined;
  let clientPromise: Promise<RuntimeGrpcBridgeClient> | undefined;
  const ensureClient = () => {
    clientPromise ??= Promise.resolve(createGrpcClient(runtimeEndpoint));
    return clientPromise;
  };
  if (standardShellHost?.standardDataRootBinding?.source === 'runtime-get-app-storage') {
    bindElectronStandardDataRootRuntimeResolver(standardShellHost, {
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
  const desktopUnaries = new Map<string, ActiveRuntimeUnary>();
  const bundledAvatarStreamsBySender = new Map<object, Map<string, RuntimeGrpcBridgeStream>>();
  const bundledAvatarUnariesBySender = new Map<object, Map<string, ActiveRuntimeUnary>>();
  const bundledAvatarStreamsFor = (sender: object): Map<string, RuntimeGrpcBridgeStream> => {
    let streams = bundledAvatarStreamsBySender.get(sender);
    if (!streams) {
      streams = new Map();
      bundledAvatarStreamsBySender.set(sender, streams);
    }
    return streams;
  };
  const bundledAvatarUnariesFor = (sender: object): Map<string, ActiveRuntimeUnary> => {
    let unaries = bundledAvatarUnariesBySender.get(sender);
    if (!unaries) {
      unaries = new Map();
      bundledAvatarUnariesBySender.set(sender, unaries);
    }
    return unaries;
  };
  const cancelRuntimeUnaries = (unaries: Map<string, ActiveRuntimeUnary>, message: string) => {
    for (const record of unaries.values()) {
      if (!record.controller.signal.aborted) {
        record.controller.abort(new DOMException(message, 'AbortError'));
      }
    }
  };
  // @nimi-authority: rule.nimi.desktop.shell-runtime.r011
  const unsubscribeDesktopInvalidation = input.desktopHost?.subscribeSenderInvalidation(() => {
    for (const stream of desktopStreams.values()) stream.cancel();
    desktopStreams.clear();
    cancelRuntimeUnaries(desktopUnaries, 'Desktop renderer was invalidated during Runtime unary');
    desktopAccountHost?.close();
  });
  const unsubscribeBundledAvatarInvalidation = input.bundledAvatarHost?.subscribeSenderInvalidation((sender) => {
    const streams = bundledAvatarStreamsBySender.get(sender);
    for (const stream of streams?.values() ?? []) stream.cancel();
    streams?.clear();
    bundledAvatarStreamsBySender.delete(sender);
    const unaries = bundledAvatarUnariesBySender.get(sender);
    cancelRuntimeUnaries(unaries ?? new Map(), 'Bundled Avatar renderer was invalidated during Runtime unary');
    bundledAvatarUnariesBySender.delete(sender);
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
        standardShellHost: bundledAvatarStandardShellHost,
        commandPolicy: input.bundledAvatarHost?.commandPolicy,
        commandHandlers: input.bundledAvatarHost?.commandHandlers,
        streams: bundledAvatarStreamsFor(event.sender as object),
        unaries: bundledAvatarUnariesFor(event.sender as object),
      };
    }
    assertAllowedElectronRendererUrl({ url: rendererUrl, allowedUrls: allowedRendererUrls });
    return {
      appId,
      bundledAvatarProfile: false,
      desktopSenderAuthorized: input.desktopHost?.authorizeSender(event) === true,
      capabilitySet,
      standardShellHost,
      commandPolicy: input.commandPolicy,
      commandHandlers: input.commandHandlers,
      streams: desktopStreams,
      unaries: desktopUnaries,
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
      if (runtimePayload.cancel === true) {
        const cancellation = parseElectronRuntimeUnaryCancelRequest(runtimePayload);
        const active = rendererProfile.unaries.get(cancellation.requestId);
        if (active && !active.controller.signal.aborted) {
          active.controller.abort(new DOMException('Runtime unary was canceled by its renderer owner', 'AbortError'));
        }
        if (active) await active.completion;
        return { canceled: Boolean(active) };
      }
      const request = parseElectronRuntimeUnaryRequest(runtimePayload);
      const requestId = request.requestId ?? createElectronHostUnaryRequestId();
      if (rendererProfile.unaries.has(requestId)) {
        throw duplicateElectronRuntimeUnaryRequest(requestId);
      }
      const controller = new AbortController();
      const operation = (async () => invokeElectronRuntimeUnary({
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
        requestId,
        signal: controller.signal,
      }))();
      const completion = operation.then(() => undefined, () => undefined).finally(() => {
        if (rendererProfile.unaries.get(requestId)?.controller === controller) {
          rendererProfile.unaries.delete(requestId);
        }
      });
      rendererProfile.unaries.set(requestId, { controller, completion });
      return operation;
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
      if (runtimeLifecycleHost) {
        return runtimeLifecycleHost.invoke(command, commandNames);
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
      if (runtimeLifecycleHost) {
        return runtimeLifecycleHost.invoke(command, commandNames);
      }
      throw createElectronExternalDaemonRequiredError(command);
    }
    const standardPayload = standardNestedPayload(payload, command);
    const runDataRootOperation = <T>(operation: () => Promise<T>): Promise<T> => (
      effectiveStandardShellHost?.runDataRootOperation
        ? effectiveStandardShellHost.runDataRootOperation(operation)
        : operation()
    );
    if (isElectronLocalAppAssetMediaCommand(command)) {
      return runDataRootOperation(() => dispatchElectronLocalAppAssetMediaCommand({
        host: effectiveStandardShellHost?.localAppAssetMediaHost,
        command,
        payload: standardPayload,
        event,
      }));
    }
    if (effectiveStandardShellHost?.localAppHost && isElectronLocalAppCommand(command)) {
      return runDataRootOperation(async () => {
        const result = await dispatchElectronLocalAppCommand({
          host: effectiveStandardShellHost.localAppHost,
          payload: standardPayload,
          command,
          sendEvent: event.sender?.send
            ? (eventName, eventPayload) => event.sender?.send?.(`${eventChannelPrefix}${eventName}`, eventPayload)
            : undefined,
        });
        const mediaHost = effectiveStandardShellHost.localAppAssetMediaHost;
        if (mediaHost) {
          if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetRemove']) mediaHost.invalidatePath(String(standardPayload.relativePath));
          if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetMove']) {
            mediaHost.invalidatePath(String(standardPayload.fromRelativePath));
            mediaHost.invalidatePath(String(standardPayload.toRelativePath));
          }
          if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetAdopt']) mediaHost.invalidatePath(String(standardPayload.relativePath));
          if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteCommit'] && result && typeof result === 'object') {
            mediaHost.invalidatePath(String((result as Record<string, unknown>).relativePath));
          }
        }
        return result;
      });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']) return runDataRootOperation(() => resolveElectronStandardDataPath(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']) return runDataRootOperation(() => readElectronStandardStorageJson(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']) return runDataRootOperation(() => writeElectronStandardStorageJson(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']) return runDataRootOperation(() => removeElectronStandardStorageJson(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']) return openElectronExternalUrl(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode']) return listenElectronOauthForCode(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']) return openElectronDesktopIntent({ host: effectiveStandardShellHost, payload: standardPayload, command, appId: effectiveAppId });
    if (command === NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff']) return handoffElectronAvatarHost({ host: effectiveStandardShellHost, payload: standardPayload, command, appId: effectiveAppId });
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']) {
      return confirmElectronShellDialog({ host: effectiveStandardShellHost, payload: standardPayload, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag']) {
      return startElectronWindowDrag({ host: effectiveStandardShellHost, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow']) {
      return focusElectronMainWindow({ host: effectiveStandardShellHost, command, event, appId: effectiveAppId, runtimeEndpoint });
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']) return runDataRootOperation(() => resolveElectronStandardLocalAssetUrl(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']) return openElectronShellFileDialog(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']) return runDataRootOperation(() => revealElectronShellFile(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']) return saveElectronShellExportFile(effectiveStandardShellHost, standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']) return runDataRootOperation(() => writeElectronShellArtifact(effectiveStandardShellHost, standardPayload, command));
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
    if (command === NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve']) return runDataRootOperation(() => resolveElectronAvatarAssetUrl(effectiveStandardShellHost, standardPayload, command));
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get']) return resolveElectronAiProfile(standardPayload, command);
    if (command === NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']) return resolveElectronPlatformProjection(standardPayload, command);
    if (!rendererProfile.bundledAvatarProfile && desktopAccountHost && isElectronDesktopAccountCommand(command)) {
      return desktopAccountHost.invoke(command, payload, {
        eventChannelPrefix,
        sender: event.sender,
      });
    }
    if (!rendererProfile.bundledAvatarProfile && developerModeHost && isElectronDeveloperModeCommand(command)) {
      return developerModeHost.invoke(command, payload);
    }
    if (commandHandler) {
      return await commandHandler({
        command,
        payload,
        event,
        appId: effectiveAppId,
        runtimeEndpoint,
        sendEvent: event.sender?.send
          ? (eventName, eventPayload) => event.sender?.send?.(`${eventChannelPrefix}${eventName}`, eventPayload)
          : undefined,
      });
    }
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
      return {
        ok: false,
        error: toSerializedElectronShellError(error, input.runtimeLifecycleProfile),
      };
    }
  });

  return {
    invokeChannel,
    ...(bundledAvatarStandardShellHost?.localAppHost
      ? { bundledAvatarLocalAppHost: bundledAvatarStandardShellHost.localAppHost }
      : {}),
    unregister: () => {
      input.ipcMain.removeHandler?.(invokeChannel);
      for (const stream of desktopStreams.values()) stream.cancel();
      cancelRuntimeUnaries(desktopUnaries, 'Electron Runtime bridge was unregistered during unary');
      for (const streams of bundledAvatarStreamsBySender.values()) {
        for (const stream of streams.values()) stream.cancel();
        streams.clear();
      }
      for (const unaries of bundledAvatarUnariesBySender.values()) {
        cancelRuntimeUnaries(unaries, 'Electron Runtime bridge was unregistered during unary');
      }
      desktopStreams.clear();
      desktopUnaries.clear();
      bundledAvatarStreamsBySender.clear();
      bundledAvatarUnariesBySender.clear();
      unsubscribeDesktopInvalidation?.();
      unsubscribeBundledAvatarInvalidation?.();
      desktopAccountHost?.close();
      void clientPromise?.then((client) => client.close()).catch(() => undefined);
    },
  };
}

let electronHostUnaryRequestCounter = 0;

function createElectronHostUnaryRequestId(): string {
  electronHostUnaryRequestCounter += 1;
  return `electron-host-unary-${Date.now()}-${electronHostUnaryRequestCounter}`;
}

function duplicateElectronRuntimeUnaryRequest(requestId: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: 'Electron Runtime unary request identity is already active',
    reasonCode: 'electron-runtime-unary-request-active',
    actionHint: 'use_unique_runtime_unary_request_id',
    details: { requestId },
  });
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
