import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  parseAvatarLaunchHandoffPayload,
  type AvatarLaunchHandoffPayload,
  type AvatarLaunchHandoffResult,
} from '@nimiplatform/kit/features/avatar/headless';

export const ZHIYU_AVATAR_LAUNCH_HANDOFF_CHANNEL = 'zhiyu:avatar-launch-handoff';

export type ZhiyuAvatarElectronLaunchEnvironmentInput = {
  readonly runtimeEndpoint: string;
  readonly dataRoot: string;
  readonly payload: AvatarLaunchHandoffPayload;
};

export type ZhiyuAvatarLaunchHandoffBridgeOptions = {
  readonly ipcMain: IpcMain;
  readonly dataRoot: string;
  readonly runtimeEndpoint: string;
  readonly isAllowedRendererUrl: (url: string) => boolean;
  readonly avatarElectronMainPath?: string;
  readonly electronExecutablePath?: string;
  readonly spawnChild?: typeof spawn;
};

export function registerZhiyuAvatarLaunchHandoffBridge(
  options: ZhiyuAvatarLaunchHandoffBridgeOptions,
): void {
  options.ipcMain.handle(ZHIYU_AVATAR_LAUNCH_HANDOFF_CHANNEL, async (event, message) => {
    assertAllowedRenderer(event, options.isAllowedRendererUrl);
    const envelope = asRecord(message, 'Zhiyu Avatar launch handoff message must be an object');
    const command = requireText(envelope.command, 'command');
    if (command !== 'avatar.launch') {
      throw new Error(`Unsupported Zhiyu Avatar launch handoff command: ${command}`);
    }
    const payload = parseAvatarLaunchHandoffPayload(envelope.payload);
    return launchZhiyuAvatarElectron({
      payload,
      runtimeEndpoint: options.runtimeEndpoint,
      dataRoot: options.dataRoot,
      avatarElectronMainPath: options.avatarElectronMainPath,
      electronExecutablePath: options.electronExecutablePath,
      spawnChild: options.spawnChild,
    });
  });
}

export function buildZhiyuAvatarElectronLaunchEnvironment(
  input: ZhiyuAvatarElectronLaunchEnvironmentInput,
): Record<string, string> {
  const payload = parseAvatarLaunchHandoffPayload(input.payload);
  const launchDataRoot = path.join(
    path.resolve(requireText(input.dataRoot, 'dataRoot')),
    'avatar-launches',
    safePathSegment(payload.avatarInstanceId || payload.localAgentRef),
  );
  const env: Record<string, string> = {
    NIMI_RUNTIME_GRPC_ADDR: requireText(input.runtimeEndpoint, 'runtimeEndpoint'),
    NIMI_AVATAR_ELECTRON_RUNTIME_ENDPOINT: requireText(input.runtimeEndpoint, 'runtimeEndpoint'),
    NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID: payload.ownerUserId,
    NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF: payload.runtimeSourceRef,
    NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF: payload.localAgentRef,
    NIMI_AVATAR_ELECTRON_STANDARD_DATA_ROOT: launchDataRoot,
    NIMI_AVATAR_ELECTRON_AGENT_CENTER_DATA_ROOT: path.resolve(requireText(input.dataRoot, 'dataRoot')),
  };
  if (payload.avatarInstanceId) {
    env.NIMI_AVATAR_ELECTRON_AVATAR_INSTANCE_ID = payload.avatarInstanceId;
  }
  if (payload.launchSource) {
    env.NIMI_AVATAR_ELECTRON_LAUNCH_SOURCE = payload.launchSource;
  }
  const rendererUrl = normalizeText(process.env.NIMI_ZHIYU_AVATAR_ELECTRON_RENDERER_URL);
  if (rendererUrl) {
    env.NIMI_AVATAR_ELECTRON_RENDERER_URL = rendererUrl;
  }
  return env;
}

export function launchZhiyuAvatarElectron(input: {
  readonly payload: AvatarLaunchHandoffPayload;
  readonly runtimeEndpoint: string;
  readonly dataRoot: string;
  readonly avatarElectronMainPath?: string;
  readonly electronExecutablePath?: string;
  readonly spawnChild?: typeof spawn;
}): AvatarLaunchHandoffResult {
  const payload = parseAvatarLaunchHandoffPayload(input.payload);
  const avatarMainPath = resolveAvatarElectronMainPath(input.avatarElectronMainPath);
  if (!existsSync(avatarMainPath)) {
    throw Object.assign(new Error(`Avatar Electron main bundle is not available: ${avatarMainPath}`), {
      reasonCode: 'zhiyu-avatar-electron-main-missing',
      actionHint: 'build_avatar_electron_bundle',
      source: 'electron-main',
    });
  }
  const electronExecutablePath = normalizeText(input.electronExecutablePath) || process.execPath;
  const child = (input.spawnChild ?? spawn)(electronExecutablePath, [avatarMainPath], {
    env: {
      ...process.env,
      ...buildZhiyuAvatarElectronLaunchEnvironment({
        runtimeEndpoint: input.runtimeEndpoint,
        dataRoot: input.dataRoot,
        payload,
      }),
    },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return {
    opened: true,
    avatarInstanceId: payload.avatarInstanceId,
    handoffUri: `electron:${avatarMainPath}`,
    launchSource: payload.launchSource,
    pid: normalizePid(child),
  };
}

function assertAllowedRenderer(
  event: IpcMainInvokeEvent,
  isAllowedRendererUrl: (url: string) => boolean,
): void {
  const url = normalizeText(event.senderFrame?.url);
  if (!isAllowedRendererUrl(url)) {
    throw new Error(`Zhiyu Avatar launch renderer URL is not allowed: ${url || '<missing>'}`);
  }
}

function resolveAvatarElectronMainPath(explicitPath: string | undefined): string {
  const fromOption = normalizeText(explicitPath);
  if (fromOption) {
    return path.resolve(fromOption);
  }
  const fromEnv = normalizeText(process.env.NIMI_ZHIYU_AVATAR_ELECTRON_MAIN_PATH);
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.resolve(resolveCurrentDir(), '..', '..', 'avatar', 'dist-electron', 'main.js');
}

function resolveCurrentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function normalizePid(child: ChildProcess): number | null {
  return typeof child.pid === 'number' && Number.isSafeInteger(child.pid) && child.pid > 0
    ? child.pid
    : null;
}

function asRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Zhiyu Avatar launch handoff requires ${field}`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safePathSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'avatar';
}
