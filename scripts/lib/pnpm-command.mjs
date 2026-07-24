import { resolveBinaryOnPath } from './binary-path.mjs';

export function pnpmCommandForPlatform(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

export function composePnpmSpawn(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') {
    return { command: 'pnpm', args };
  }

  const resolved = resolveBinaryOnPath('pnpm', env, platform) ?? pnpmCommandForPlatform(platform);
  if (/\.(?:cmd|bat)$/iu.test(resolved)) {
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', composeCmdCommandLine(resolved, args)],
      windowsVerbatimArguments: true,
    };
  }

  return { command: resolved, args };
}

function composeCmdCommandLine(command, args) {
  const parts = [quoteCmdArg(command, { force: true }), ...args.map((arg) => quoteCmdArg(arg))];
  const line = parts.join(' ');
  return parts.slice(1).some((part) => part.startsWith('"')) ? `"${line}"` : line;
}

function quoteCmdArg(value, options = {}) {
  const text = String(value);
  if (options.force !== true && /^[^\s"&|<>^]+$/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/gu, '""')}"`;
}
