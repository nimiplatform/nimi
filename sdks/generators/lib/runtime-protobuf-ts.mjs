import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkMode, repoRoot, relPath } from './context.mjs';

const targetRelativeDir = 'sdks/typescript/core-generated/runtime-protobuf';
const targetDir = path.join(repoRoot, targetRelativeDir);
const localNodeBinDir = path.join(repoRoot, 'node_modules', '.bin');

function pathEnvKey() {
  if (process.platform !== 'win32') {
    return 'PATH';
  }
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path';
}

function envWithLocalNodeBin() {
  const key = pathEnvKey();
  const current = process.env[key] || process.env.PATH || '';
  return {
    ...process.env,
    [key]: current ? `${localNodeBinDir}${path.delimiter}${current}` : localNodeBinDir,
  };
}

function listGeneratedTsFiles(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }
  const output = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        output.push(absolute);
      }
    }
  };
  visit(rootDir);
  return output.sort((a, b) => relPath(a).localeCompare(relPath(b)));
}

function snapshot(rootDir) {
  const files = new Map();
  for (const absolute of listGeneratedTsFiles(rootDir)) {
    files.set(path.relative(rootDir, absolute).replaceAll(path.sep, '/'), readFileSync(absolute, 'utf8'));
  }
  return files;
}

function renderBufTemplate(outDir) {
  return `version: v2
plugins:
  - local: protoc-gen-ts
    out: ${outDir}
    opt:
      - long_type_string
      - ts_nocheck
      - client_none
`;
}

function runBufGenerate(outDir) {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdks-runtime-protobuf-'));
  const templatePath = path.join(workDir, 'buf.gen.yaml');
  writeFileSync(templatePath, renderBufTemplate(outDir), 'utf8');

  const result = spawnSync('buf', ['generate', '--template', templatePath], {
    cwd: path.join(repoRoot, 'proto'),
    env: envWithLocalNodeBin(),
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  rmSync(workDir, { recursive: true, force: true });

  if ((result.status ?? 1) !== 0) {
    throw new Error([
      'failed to generate TypeScript Runtime protobuf artifacts with buf',
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  stripRuntimeRpcServiceTypes(outDir);
}

function stripRuntimeRpcServiceTypes(outDir) {
  for (const file of listGeneratedTsFiles(outDir)) {
    let source = readFileSync(file, 'utf8');
    source = source.replace(/^import \{ ServiceType \} from "@protobuf-ts\/runtime-rpc";\n/m, '');
    source = source.replace(
      /\/\*\*\n \* @generated ServiceType for protobuf service [\s\S]*?\nexport const [A-Za-z0-9_]+ = new ServiceType\([\s\S]*?\n\]\);\n/g,
      '',
    );
    writeFileSync(file, source, 'utf8');
  }
}

function compareSnapshots(expected, actual) {
  const violations = [];
  const names = new Set([...expected.keys(), ...actual.keys()]);
  for (const name of [...names].sort()) {
    if (!actual.has(name)) {
      violations.push(`missing generated protobuf artifact: ${targetRelativeDir}/${name}`);
      continue;
    }
    if (!expected.has(name)) {
      violations.push(`stale generated protobuf artifact: ${targetRelativeDir}/${name}`);
      continue;
    }
    if (actual.get(name) !== expected.get(name)) {
      violations.push(`generated protobuf artifact drift: ${targetRelativeDir}/${name}`);
    }
  }
  return violations;
}

export function writeTypescriptRuntimeProtobuf() {
  if (checkMode) {
    const expectedDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdks-runtime-protobuf-check-'));
    try {
      runBufGenerate(expectedDir);
      const violations = compareSnapshots(snapshot(expectedDir), snapshot(targetDir));
      if (violations.length > 0) {
        throw new Error(violations.join('\n'));
      }
    } finally {
      rmSync(expectedDir, { recursive: true, force: true });
    }
    return;
  }

  rmSync(targetDir, { recursive: true, force: true });
  runBufGenerate(targetDir);
}
