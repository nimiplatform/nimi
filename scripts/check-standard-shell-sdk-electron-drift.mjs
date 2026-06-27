import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml');
const sdkPath = path.join(repoRoot, 'sdks/typescript/runtime/electron-ipc.ts');

const catalog = YAML.parse(readFileSync(catalogPath, 'utf8'));
const sdkSource = readFileSync(sdkPath, 'utf8');
const failures = [];

const runtimeCapability = catalog.capabilities?.find((capability) => capability?.id === 'runtime');
const runtimeCommands = new Map(
  (runtimeCapability?.operations ?? []).map((operation) => [operation.id, operation.command]),
);
const expected = {
  unary: runtimeCommands.get('unary'),
  stream_open: runtimeCommands.get('streamOpen'),
  stream_close: runtimeCommands.get('streamClose'),
};

for (const [key, command] of Object.entries(expected)) {
  if (!command) {
    failures.push(`${catalogPath}: missing runtime operation for ${key}`);
    continue;
  }
  const pattern = new RegExp(`${key}:\\s*['"]${escapeRegExp(command)}['"]`, 'u');
  if (!pattern.test(sdkSource)) {
    failures.push(`${sdkPath}: STANDARD_ELECTRON_RUNTIME_COMMANDS.${key} must equal ${command}`);
  }
}

if (/commandNamespace|eventNamespace\?:/u.test(sdkSource)) {
  failures.push(`${sdkPath}: electron-ipc transport must not admit commandNamespace/eventNamespace overrides`);
}
if (/options\.commandNamespace|options\.eventNamespace/u.test(sdkSource)) {
  failures.push(`${sdkPath}: electron-ipc transport must not read commandNamespace/eventNamespace from callers`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
