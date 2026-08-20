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

const AVATAR_VALUE_OPTIONS = new Set(['--uri', '--agent-id', '--instance-id']);
const AVATAR_FLAG_OPTIONS = new Set(['--no-kill-existing', '--dry-run']);
const TAURI_ONLY_AVATAR_OPTIONS = new Set(['--uri', '--no-kill-existing', '--dry-run']);

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
    `Usage: pnpm dev:${appName} [--cdp[=<port>]]${definition.supportsTauri ? ' [--tauri]' : ''}`,
    '',
    'Options:',
    `  --cdp              Enable loopback Electron CDP on the app default (${definition.defaultCdpPort}).`,
    '  --cdp=<port>       Enable loopback Electron CDP on an explicit port.',
  ];
  if (definition.supportsTauri) {
    lines.push(
      '  --tauri            Use the Avatar Tauri carrier instead of the default Electron carrier.',
      '  --agent-id <ref>    Select the Avatar local-agent ref.',
      '  --instance-id <id>  Select the Avatar instance.',
      '  --uri <uri>         Pass an explicit launch URI to the Tauri carrier.',
      '  --no-kill-existing  Keep an existing Tauri Avatar process.',
      '  --dry-run           Resolve the Tauri launch without starting it.',
      '',
      'Electron Avatar is an avatar-only Desktop carrier and cannot run beside the regular Desktop dev instance.',
      'CDP is unavailable with --tauri.',
    );
  }
  lines.push('', 'CDP is disabled when --cdp is omitted.', '');
  return lines.join('\n');
}

export function parseDevAppArguments(appName, argv = []) {
  const definition = requireDefinition(appName);
  let carrier = 'electron';
  let carrierSeen = false;
  let cdpRequested = false;
  let cdpPort;
  let help = false;
  const avatarArguments = [];
  const avatarOptions = new Map();

  const setCdpPort = (rawValue, option) => {
    if (cdpRequested) {
      throw launchError('dev-app-cdp-duplicate', 'CDP may only be configured once.');
    }
    cdpRequested = true;
    cdpPort = rawValue === undefined
      ? definition.defaultCdpPort
      : normalizeCdpPort(rawValue, option);
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
    if (argument === '--cdp') {
      const next = argv[index + 1];
      if (next !== undefined && !String(next).startsWith('-')) {
        setCdpPort(next, '--cdp');
        index += 1;
      } else {
        setCdpPort(undefined, '--cdp');
      }
      continue;
    }
    if (argument.startsWith('--cdp=')) {
      setCdpPort(argument.slice('--cdp='.length), '--cdp');
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
  if (carrier === 'tauri' && cdpRequested) {
    throw launchError('dev-app-tauri-cdp-unsupported', 'CDP is available only for the Electron carrier; remove --cdp or --tauri.');
  }
  if (carrier === 'electron') {
    for (const option of TAURI_ONLY_AVATAR_OPTIONS) {
      if (avatarOptions.has(option)) {
        throw launchError('dev-app-avatar-option-requires-tauri', `${option} requires --tauri.`);
      }
    }
  }

  const envOverrides = {};
  if (carrier === 'electron' && avatarOptions.has('--agent-id')) {
    envOverrides.NIMI_AVATAR_AGENT_ID = avatarOptions.get('--agent-id');
  }
  if (carrier === 'electron' && avatarOptions.has('--instance-id')) {
    envOverrides.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID = avatarOptions.get('--instance-id');
  }

  return {
    appName,
    carrier,
    cdpPort: cdpRequested ? cdpPort : undefined,
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
