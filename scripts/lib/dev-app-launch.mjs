import { createServer } from 'node:net';

import { composePnpmSpawn } from './pnpm-command.mjs';

export const DEV_APP_DEFINITIONS = Object.freeze({
  desktop: Object.freeze({
    packageName: '@nimiplatform/desktop',
    defaultCdpPort: 9333,
  }),
  zhiyu: Object.freeze({
    packageName: '@nimiplatform/zhiyu',
    defaultCdpPort: 9334,
  }),
  lab: Object.freeze({
    packageName: '@nimiplatform/lab',
    defaultCdpPort: 9335,
  }),
  avatar: Object.freeze({
    packageName: '@nimiplatform/avatar',
    defaultCdpPort: 9336,
  }),
});

const AVATAR_VALUE_OPTIONS = new Set([
  '--agent-handle',
  '--instance-id',
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
    `Usage: pnpm dev:${appName} [--cdp-port <port> | --no-cdp]`,
    '',
    'Options:',
    `  --cdp-port <port>  Override the default loopback Electron CDP port (${definition.defaultCdpPort}).`,
    '  --no-cdp           Disable Electron CDP for this launch.',
  ];
  if (appName === 'avatar') {
    lines.push(
      '  --agent-handle <h>  Select a current-session canonical Agent handle.',
      '  --instance-id <id>  Select the Avatar instance.',
      '',
      'Electron Avatar is an avatar-only Desktop carrier and cannot run beside the regular Desktop dev instance.',
    );
  }
  lines.push('', `Electron CDP defaults to 127.0.0.1:${definition.defaultCdpPort}.`, '');
  return lines.join('\n');
}

export function parseDevAppArguments(appName, argv = []) {
  const definition = requireDefinition(appName);
  let cdpOption;
  let cdpPort = definition.defaultCdpPort;
  let help = false;
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
    if (argument === '--electron') {
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
      index += 1;
      continue;
    }
    throw launchError('dev-app-option-unsupported', `Unsupported dev:${appName} option: ${argument}`);
  }

  const envOverrides = {};
  if (avatarOptions.has('--agent-handle')) {
    envOverrides.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_HANDLE = avatarOptions.get('--agent-handle');
  }
  if (avatarOptions.has('--instance-id')) {
    envOverrides.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID = avatarOptions.get('--instance-id');
  }

  return {
    appName,
    carrier: 'electron',
    cdpPort,
    cdpDisabled: cdpOption === '--no-cdp',
    help,
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
