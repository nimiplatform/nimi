import { createServer } from 'node:net';
import path from 'node:path';

import { composePnpmSpawn } from './pnpm-command.mjs';

export const DEV_APP_DEFINITIONS = Object.freeze({
  desktop: Object.freeze({
    packageName: '@nimiplatform/desktop',
    defaultCdpPort: 9333,
    supportsTauri: false,
  }),
  zhiyu: Object.freeze({
    packageName: '@nimiplatform/zhiyu',
    defaultCdpPort: 9334,
    supportsTauri: false,
  }),
  lab: Object.freeze({
    packageName: '@nimiplatform/lab',
    defaultCdpPort: 9335,
    supportsTauri: false,
  }),
  avatar: Object.freeze({
    packageName: '@nimiplatform/avatar',
    defaultCdpPort: 9336,
    supportsTauri: true,
  }),
});

const AVATAR_VALUE_OPTIONS = new Set([
  '--uri',
  '--agent-handle',
  '--conversation-anchor-id',
  '--instance-id',
]);
const AVATAR_FLAG_OPTIONS = new Set(['--no-kill-existing', '--dry-run']);
const TAURI_ONLY_AVATAR_OPTIONS = new Set([
  '--uri',
  '--conversation-anchor-id',
  '--no-kill-existing',
  '--dry-run',
]);

export class DevAppLaunchError extends Error {
  constructor(reasonCode, message) {
    super(message);
    this.name = 'DevAppLaunchError';
    this.reasonCode = reasonCode;
  }
}

export function devAppUsage(appName) {
  const definition = requireDefinition(appName);
  const lines = [
    `Usage: pnpm dev:${appName} [--cdp-port <port> | --no-cdp]${definition.supportsTauri ? ' [--tauri]' : ''}`,
    '',
    'Options:',
    `  --cdp-port <port>  Override the default loopback Electron CDP port (${definition.defaultCdpPort}).`,
    '  --no-cdp           Disable Electron CDP for this launch.',
  ];
  if (definition.supportsTauri) {
    lines.push(
      '  --tauri            Use the Avatar Tauri carrier instead of the default Electron carrier.',
      '  --agent-handle <h>  Select a current-session canonical Agent handle.',
      '  --conversation-anchor-id <id>',
      '                     Bind the explicit Tauri carrier to an exact Conversation.',
      '  --instance-id <id>  Select the Avatar instance.',
      '  --uri <uri>         Pass an explicit launch URI to the Tauri carrier.',
      '  --no-kill-existing  Keep an existing Tauri Avatar process.',
      '  --dry-run           Resolve the Tauri launch without starting it.',
      '',
      'Electron Avatar is an avatar-only Desktop carrier and cannot run beside the regular Desktop dev instance.',
      'CDP is unavailable with --tauri.',
    );
  }
  lines.push('', `Electron CDP defaults to 127.0.0.1:${definition.defaultCdpPort}.`, '');
  return lines.join('\n');
}

export function parseDevAppArguments(appName, argv = []) {
  const definition = requireDefinition(appName);
  let carrier = 'electron';
  let carrierSeen = false;
  let cdpOption;
  let cdpPort = definition.defaultCdpPort;
  let help = false;
  const avatarArguments = [];
  const avatarOptions = new Map();

  const setCdpPort = (rawValue, option) => {
    if (cdpOption !== undefined) {
      throw launchError('dev-app-cdp-duplicate', 'CDP may only be configured once.');
    }
    cdpOption = option;
    cdpPort = normalizeCdpPort(rawValue, option);
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--electron' || argument === '--tauri') {
      if (carrierSeen) {
        throw launchError('dev-app-carrier-duplicate', 'The development carrier may only be selected once.');
      }
      carrier = argument === '--tauri' ? 'tauri' : 'electron';
      carrierSeen = true;
      continue;
    }
    if (argument === '--no-cdp') {
      if (cdpOption !== undefined) {
        throw launchError('dev-app-cdp-duplicate', 'CDP may only be configured once.');
      }
      cdpOption = '--no-cdp';
      cdpPort = undefined;
      continue;
    }
    if (argument === '--cdp-port') {
      const value = requireOptionValue(argv, index, '--cdp-port');
      setCdpPort(value, '--cdp-port');
      index += 1;
      continue;
    }
    if (argument.startsWith('--cdp-port=')) {
      setCdpPort(argument.slice('--cdp-port='.length), '--cdp-port');
      continue;
    }
    if (AVATAR_VALUE_OPTIONS.has(argument)) {
      requireAvatarOption(appName, argument);
      if (avatarOptions.has(argument)) {
        throw launchError('dev-app-option-duplicate', `${argument} may only be provided once.`);
      }
      const value = requireOptionValue(argv, index, argument);
      avatarOptions.set(argument, value);
      avatarArguments.push(argument, value);
      index += 1;
      continue;
    }
    if (AVATAR_FLAG_OPTIONS.has(argument)) {
      requireAvatarOption(appName, argument);
      if (avatarOptions.has(argument)) {
        throw launchError('dev-app-option-duplicate', `${argument} may only be provided once.`);
      }
      avatarOptions.set(argument, true);
      avatarArguments.push(argument);
      continue;
    }
    throw launchError('dev-app-option-unsupported', `Unsupported dev:${appName} option: ${argument}`);
  }

  if (carrier === 'tauri' && !definition.supportsTauri) {
    throw launchError('dev-app-carrier-unsupported', `dev:${appName} does not support --tauri.`);
  }
  if (carrier === 'tauri' && cdpOption === '--cdp-port') {
    throw launchError('dev-app-tauri-cdp-unsupported', 'CDP is available only for the Electron carrier; remove --cdp-port or --tauri.');
  }
  if (carrier === 'electron') {
    for (const option of TAURI_ONLY_AVATAR_OPTIONS) {
      if (avatarOptions.has(option)) {
        throw launchError('dev-app-avatar-option-requires-tauri', `${option} requires --tauri.`);
      }
    }
  }

  const envOverrides = {};
  if (carrier === 'electron' && avatarOptions.has('--agent-handle')) {
    envOverrides.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_HANDLE = avatarOptions.get('--agent-handle');
  }
  if (carrier === 'electron' && avatarOptions.has('--instance-id')) {
    envOverrides.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID = avatarOptions.get('--instance-id');
  }

  return {
    appName,
    carrier,
    cdpPort: carrier === 'electron' ? cdpPort : undefined,
    cdpDisabled: carrier === 'electron' && cdpOption === '--no-cdp',
    help,
    avatarArguments,
    envOverrides,
  };
}

export function resolveDevAppLaunch(appName, argv = [], options = {}) {
  const definition = requireDefinition(appName);
  const parsed = parseDevAppArguments(appName, argv);
  if (parsed.help) {
    return {
      kind: 'help',
      appName,
      output: devAppUsage(appName),
    };
  }

  if (parsed.carrier === 'tauri') {
    return {
      kind: 'launch',
      appName,
      carrier: 'tauri',
      cdpPort: undefined,
      command: options.nodeExecutable ?? process.execPath,
      args: [path.join('scripts', 'dev-avatar.mjs'), ...parsed.avatarArguments],
      envOverrides: {},
    };
  }

  const pnpmArgs = ['--filter', definition.packageName, 'run', 'dev:electron'];
  if (parsed.cdpPort !== undefined) {
    pnpmArgs.push('--', '--cdp-port', String(parsed.cdpPort));
  } else if (parsed.cdpDisabled) {
    pnpmArgs.push('--', '--no-cdp');
  }
  const invocation = composePnpmSpawn(pnpmArgs, {
    platform: options.platform,
    env: options.env,
  });
  return {
    kind: 'launch',
    appName,
    carrier: 'electron',
    cdpPort: parsed.cdpPort,
    ...invocation,
    envOverrides: parsed.envOverrides,
  };
}

export function devAppLaunchSummary(plan) {
  if (plan.kind !== 'launch') return '';
  if (plan.carrier === 'tauri') return `[dev-app] ${plan.appName}: Tauri carrier; CDP unavailable\n`;
  const cdp = plan.cdpPort === undefined
    ? 'CDP disabled'
    : `CDP http://127.0.0.1:${plan.cdpPort}`;
  return `[dev-app] ${plan.appName}: Electron carrier; ${cdp}\n`;
}

export async function assertDevAppCdpPortAvailable(port) {
  if (port === undefined) return;
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host: '127.0.0.1', port, exclusive: true });
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
      throw launchError(
        'dev-app-cdp-port-in-use',
        `Electron CDP port 127.0.0.1:${port} is unavailable; stop the occupying process or pass --cdp-port <port>.`,
      );
    }
    throw error;
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

function requireDefinition(appName) {
  const definition = Object.hasOwn(DEV_APP_DEFINITIONS, appName)
    ? DEV_APP_DEFINITIONS[appName]
    : undefined;
  if (!definition) {
    throw launchError(
      'dev-app-unknown',
      `Unknown development app: ${String(appName || '(missing)')}. Expected desktop, zhiyu, lab, or avatar.`,
    );
  }
  return definition;
}

function requireAvatarOption(appName, option) {
  if (appName !== 'avatar') {
    throw launchError('dev-app-option-unsupported', `${option} is available only for dev:avatar.`);
  }
}

function requireOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || String(value).startsWith('--') || String(value).length === 0) {
    throw launchError('dev-app-option-value-missing', `${option} requires a value.`);
  }
  return String(value);
}

function normalizeCdpPort(value, option) {
  const raw = String(value);
  if (raw.trim() !== raw || !/^[1-9][0-9]*$/u.test(raw)) {
    throw launchError('dev-app-cdp-port-invalid', `${option} requires a canonical decimal port from 1024 through 65535.`);
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw launchError('dev-app-cdp-port-invalid', `${option} requires a canonical decimal port from 1024 through 65535.`);
  }
  return port;
}

function launchError(reasonCode, message) {
  return new DevAppLaunchError(reasonCode, message);
}
