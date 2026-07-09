export type NimiElectronRuntimeInvoke = (command: string, payload?: unknown) => Promise<unknown>;
export type NimiElectronRuntimeListenUnsubscribe = () => void;
export type NimiElectronRuntimeListen = (
  event: string,
  handler: (event: { readonly payload: unknown }) => void,
) => NimiElectronRuntimeListenUnsubscribe;

export type NimiElectronRuntimeHook = {
  readonly invoke: NimiElectronRuntimeInvoke;
  readonly listen: NimiElectronRuntimeListen;
  readonly installedAppLaunchBinding?: NimiElectronInstalledAppLaunchBinding;
};

export type NimiElectronInstalledAppLaunchBinding = {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly bindingSource: 'host-owned-installed-app-bridge';
  readonly launchHostId: string;
  readonly launchNonce: string;
  readonly releaseDescriptorRef: string;
  readonly realmBaseUrl: string;
};

export type NimiElectronContextBridge = {
  readonly exposeInMainWorld: (apiKey: string, api: unknown) => void;
};

export type NimiElectronIpcRenderer = {
  readonly invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  readonly on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
  readonly removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
};

export type InstallNimiElectronRuntimeBridgeInput = {
  readonly contextBridge: NimiElectronContextBridge;
  readonly ipcRenderer: NimiElectronIpcRenderer;
  readonly apiKey?: string;
  readonly invokeChannel?: string;
  readonly listenChannelPrefix?: string;
};

export type InstallNimiElectronRuntimeBridgeResult = {
  readonly apiKey: string;
  readonly invokeChannel: string;
  readonly listenChannelPrefix: string;
};

const DEFAULT_API_KEY = '__NIMI_ELECTRON_RUNTIME__';
const DEFAULT_INVOKE_CHANNEL = 'nimi:runtime:invoke';
const DEFAULT_LISTEN_CHANNEL_PREFIX = 'nimi:runtime:event:';

export function installNimiElectronRuntimeBridge(
  input: InstallNimiElectronRuntimeBridgeInput,
): InstallNimiElectronRuntimeBridgeResult {
  const apiKey = normalizeToken(input.apiKey, DEFAULT_API_KEY);
  const invokeChannel = normalizeToken(input.invokeChannel, DEFAULT_INVOKE_CHANNEL);
  const listenChannelPrefix = normalizeToken(input.listenChannelPrefix, DEFAULT_LISTEN_CHANNEL_PREFIX);
  const hook: NimiElectronRuntimeHook = {
    invoke: async (command, payload) => unwrapInvokeResponse(await input.ipcRenderer.invoke(invokeChannel, {
      command: normalizeCommand(command),
      payload,
    })),
    listen: (event, handler) => {
      const eventName = normalizeCommand(event);
      const channel = `${listenChannelPrefix}${eventName}`;
      const listener = (_electronEvent: unknown, payload: unknown) => {
        handler({ payload });
      };
      input.ipcRenderer.on(channel, listener);
      return () => {
        input.ipcRenderer.removeListener(channel, listener);
      };
    },
    ...optionalInstalledAppLaunchBinding(),
  };

  input.contextBridge.exposeInMainWorld(apiKey, hook);
  return { apiKey, invokeChannel, listenChannelPrefix };
}

function optionalInstalledAppLaunchBinding(): { readonly installedAppLaunchBinding: NimiElectronInstalledAppLaunchBinding } | {} {
  const raw = process.argv.find((arg) => arg.startsWith('--nimi-installed-app-launch-binding='));
  if (!raw) {
    return {};
  }
  const encoded = raw.slice('--nimi-installed-app-launch-binding='.length).trim();
  if (!encoded) {
    return {};
  }
  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  return { installedAppLaunchBinding: parseInstalledAppLaunchBinding(parsed) };
}

function parseInstalledAppLaunchBinding(value: unknown): NimiElectronInstalledAppLaunchBinding {
  const record = asRecord(value, 'Nimi Electron installed app launch binding must be an object');
  const binding: NimiElectronInstalledAppLaunchBinding = {
    appId: requiredBindingText(record.appId, 'appId'),
    appInstanceId: requiredBindingText(record.appInstanceId, 'appInstanceId'),
    deviceId: requiredBindingText(record.deviceId, 'deviceId'),
    bindingSource: 'host-owned-installed-app-bridge',
    launchHostId: requiredBindingText(record.launchHostId, 'launchHostId'),
    launchNonce: requiredBindingText(record.launchNonce, 'launchNonce'),
    releaseDescriptorRef: requiredBindingText(record.releaseDescriptorRef, 'releaseDescriptorRef'),
    realmBaseUrl: requiredBindingText(record.realmBaseUrl, 'realmBaseUrl'),
  };
  if (record.bindingSource !== binding.bindingSource) {
    throw new Error('Nimi Electron installed app launch binding source is not host-owned.');
  }
  return binding;
}

function requiredBindingText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`Nimi Electron installed app launch binding requires ${field}`);
  }
  return normalized;
}

function unwrapInvokeResponse(response: unknown): unknown {
  const record = asRecord(response, 'Nimi Electron bridge IPC response must be an object');
  if (record.ok === true) {
    return record.value;
  }
  if (record.ok === false) {
    throw createStandardShellHostErrorRecord(record.error);
  }
  throw new Error('Nimi Electron bridge IPC response is missing ok discriminator');
}

function createStandardShellHostErrorRecord(value: unknown): Readonly<Record<string, unknown>> {
  const record = asRecord(value, 'Nimi Electron bridge standard error must be an object');
  const envelope = asOptionalRecord(record.envelope);
  const code = normalizeToken(record.code, normalizeToken(envelope?.code, 'host-internal-error'));
  const reasonCode = normalizeToken(record.reasonCode, normalizeToken(envelope?.reasonCode, 'electron-shell-host-error'));
  const actionHint = normalizeToken(record.actionHint, normalizeToken(envelope?.actionHint, 'check_electron_shell_host'));
  const source = normalizeToken(record.source, normalizeToken(envelope?.source, 'electron'));
  const details = asOptionalRecord(record.details) ?? asOptionalRecord(envelope?.details);
  return {
    name: normalizeToken(record.name, 'NimiElectronShellHostError'),
    message: normalizeToken(record.message, 'Nimi Electron shell host command failed'),
    code,
    reasonCode,
    actionHint,
    source,
    details,
    envelope: {
      code,
      reasonCode,
      actionHint,
      source,
      details,
    },
  };
}

function normalizeCommand(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error('Nimi Electron bridge command/event is required');
  }
  if (!/^[a-zA-Z0-9:._-]+$/u.test(normalized)) {
    throw new Error(`Nimi Electron bridge command/event contains unsupported characters: ${normalized}`);
  }
  return normalized;
}

function normalizeToken(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
