import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_BATCH_EXTENSIONS = new Set(['.bat', '.cmd']);
const DEFAULT_WINDOWS_PATH_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

function windowsPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
}

function windowsPathExts(env) {
  const configured = String(env.PATHEXT || '').trim();
  const values = configured ? configured.split(';') : DEFAULT_WINDOWS_PATH_EXTENSIONS;
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith('.') ? value : `.${value}`));
}

function hasPathSeparator(value) {
  return value.includes('/') || value.includes('\\');
}

function existingFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function windowsCommandCandidates(command, env) {
  const extension = path.extname(command);
  if (extension) {
    return [command];
  }
  return [...windowsPathExts(env).map((pathExt) => `${command}${pathExt}`), command];
}

function resolveWindowsCommand(command, env) {
  if (hasPathSeparator(command)) {
    for (const candidate of windowsCommandCandidates(command, env)) {
      if (existingFile(candidate)) {
        return candidate;
      }
    }
    return command;
  }

  const pathValue = String(env[windowsPathKey(env)] || env.PATH || '');
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidate of windowsCommandCandidates(path.join(directory, command), env)) {
      if (existingFile(candidate)) {
        return candidate;
      }
    }
  }
  return command;
}

function isWindowsBatchCommand(command) {
  return WINDOWS_BATCH_EXTENSIONS.has(path.extname(command).toLowerCase());
}

function quoteForCmd(value) {
  const text = String(value);
  if (text.length === 0) {
    return '""';
  }
  if (!/[\s"&()<>^|]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/(["^])/gu, '^$1')}"`;
}

function windowsBatchCommandLine(command, args) {
  return `call ${[command, ...args].map(quoteForCmd).join(' ')}`;
}

function spawnOptionsWithoutShell(options) {
  const { shell, ...rest } = options;
  return rest;
}

function spawnOptionsWithoutShellOrWindowsVerbatimArguments(options) {
  const { shell, windowsVerbatimArguments, ...rest } = options;
  return rest;
}

export function spawnSyncCommand(command, args = [], options = {}) {
  if (process.platform !== 'win32') {
    return spawnSync(command, args, {
      ...spawnOptionsWithoutShellOrWindowsVerbatimArguments(options),
      shell: false,
    });
  }

  const env = options.env || process.env;
  const resolvedCommand = resolveWindowsCommand(command, env);
  if (!isWindowsBatchCommand(resolvedCommand)) {
    return spawnSync(resolvedCommand, args, {
      ...spawnOptionsWithoutShell(options),
      shell: false,
    });
  }

  const comspec = env.ComSpec || env.COMSPEC || env.comspec || process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  return spawnSync(comspec, ['/d', '/c', windowsBatchCommandLine(resolvedCommand, args)], {
    ...spawnOptionsWithoutShellOrWindowsVerbatimArguments(options),
    env,
    shell: false,
    windowsVerbatimArguments: true,
  });
}

export function spawnCommand(command, args = [], options = {}) {
  if (process.platform !== 'win32') {
    return spawn(command, args, {
      ...spawnOptionsWithoutShellOrWindowsVerbatimArguments(options),
      shell: false,
    });
  }

  const env = options.env || process.env;
  const resolvedCommand = resolveWindowsCommand(command, env);
  if (!isWindowsBatchCommand(resolvedCommand)) {
    return spawn(resolvedCommand, args, {
      ...spawnOptionsWithoutShell(options),
      shell: false,
    });
  }

  const comspec = env.ComSpec || env.COMSPEC || env.comspec || process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  return spawn(comspec, ['/d', '/c', windowsBatchCommandLine(resolvedCommand, args)], {
    ...spawnOptionsWithoutShellOrWindowsVerbatimArguments(options),
    env,
    shell: false,
    windowsVerbatimArguments: true,
  });
}
