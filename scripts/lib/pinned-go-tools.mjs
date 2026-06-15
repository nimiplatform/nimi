import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TOOL_CONFIGS = {
  'golangci-lint': {
    binary: 'golangci-lint',
    module: 'github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2',
    modulePath: 'github.com/golangci/golangci-lint/v2',
    moduleVersion: 'v2.12.2',
  },
  govulncheck: {
    binary: 'govulncheck',
    module: 'golang.org/x/vuln/cmd/govulncheck@v1.3.0',
    modulePath: 'golang.org/x/vuln',
    moduleVersion: 'v1.3.0',
  },
  cosign: {
    binary: 'cosign',
    module: 'github.com/sigstore/cosign/v2/cmd/cosign@v2.6.2',
    modulePath: 'github.com/sigstore/cosign/v2',
    moduleVersion: 'v2.6.2',
  },
  syft: {
    binary: 'syft',
    module: 'github.com/anchore/syft/cmd/syft@v1.42.2',
    modulePath: 'github.com/anchore/syft',
    moduleVersion: 'v1.42.2',
  },
};

export function pinnedGoToolConfig(toolName) {
  const config = TOOL_CONFIGS[toolName];
  if (!config) {
    throw new Error(`unknown pinned Go tool: ${toolName}`);
  }
  return config;
}

export function goBinDir() {
  const goBin = runCapture('go', ['env', 'GOBIN']).stdout.trim();
  if (goBin) return goBin;

  const goPath = runCapture('go', ['env', 'GOPATH']).stdout.trim();
  if (!goPath) {
    throw new Error('go env GOPATH returned an empty value');
  }
  return path.join(goPath, 'bin');
}

export function ensurePinnedGoTool(toolName) {
  const config = pinnedGoToolConfig(toolName);
  const binDir = goBinDir();
  const candidates = unique([
    ...commandPathCandidates(config.binary),
    ...binaryNames(config.binary).map((binary) => path.join(binDir, binary)),
  ].filter(Boolean));

  for (const candidate of candidates) {
    if (isExecutable(candidate) && binaryMatchesPinnedModule(candidate, config)) {
      return { binaryPath: candidate, binDir, installed: false };
    }
  }

  process.stderr.write(
    `[pinned-go-tools] installing ${config.binary} from ${config.module}\n`,
  );
  runInherit('go', ['install', config.module]);

  const installedCandidates = binaryNames(config.binary).map((binary) => path.join(binDir, binary));
  const installedPath = installedCandidates.find((candidate) => isExecutable(candidate)) ?? installedCandidates[0];
  if (!isExecutable(installedPath)) {
    throw new Error(`installed ${config.binary} was not found at ${installedCandidates.join(', ')}`);
  }
  if (!binaryMatchesPinnedModule(installedPath, config)) {
    throw new Error(
      `${installedPath} does not match pinned module ${config.modulePath}@${config.moduleVersion}`,
    );
  }
  return { binaryPath: installedPath, binDir, installed: true };
}

export function runPinnedGoTool(toolName, args, options = {}) {
  const { binaryPath, binDir } = ensurePinnedGoTool(toolName);
  const result = spawnSync(binaryPath, args, {
    cwd: options.cwd ?? process.cwd(),
    env: prependPath(process.env, binDir),
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? (result.signal ? 1 : 0);
}

export function prependPath(env, binDir) {
  return {
    ...env,
    PATH: `${binDir}${path.delimiter}${env.PATH ?? ''}`,
  };
}

function binaryMatchesPinnedModule(binaryPath, config) {
  const result = spawnSync('go', ['version', '-m', binaryPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return false;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const modLine = output
    .split('\n')
    .find((line) => line.trim().startsWith(`mod\t${config.modulePath}\t`));
  if (!modLine) return false;
  const fields = modLine.trim().split('\t');
  return fields[2] === config.moduleVersion;
}

function commandPathCandidates(binary) {
  const pathValue = process.env.PATH ?? '';
  const candidates = [];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of binaryNames(binary)) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) candidates.push(candidate);
    }
  }
  return candidates;
}

function binaryNames(binary) {
  if (process.platform !== 'win32' || path.extname(binary)) {
    return [binary];
  }
  const pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return unique([
    binary,
    ...pathExt
      .split(';')
      .map((extension) => extension.trim())
      .filter(Boolean)
      .map((extension) => `${binary}${extension.toLowerCase()}`),
  ]);
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${String(result.status)}`,
    );
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runInherit(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${String(result.status ?? 'unknown')}`,
    );
  }
}

function unique(values) {
  return [...new Set(values)];
}
