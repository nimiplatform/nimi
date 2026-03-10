import { existsSync, readFileSync } from 'node:fs';

function parseEnvFile(content) {
  const output = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      output[key] = value;
    }
  }
  return output;
}

function loadEnvFile(envPath) {
  if (!envPath || !existsSync(envPath)) {
    return {};
  }
  return parseEnvFile(readFileSync(envPath, 'utf8'));
}

export function buildMergedEnv({ baseEnv = process.env, filePaths = [] } = {}) {
  const layers = filePaths.map((filePath) => loadEnvFile(filePath));
  return {
    ...Object.assign({}, ...layers),
    ...baseEnv,
  };
}
