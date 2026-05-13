#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import YAML from 'yaml';

const fail = (message) => {
  process.stderr.write(`[runtime-rpc-auth-posture-sdk-drift] ${message}\n`);
  process.exit(1);
};

const readYaml = (path) => YAML.parse(readFileSync(path, 'utf8'));

const resolveRepoRoot = () => {
  const cwd = process.cwd();
  if (existsSync(join(cwd, '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml'))) {
    return cwd;
  }
  if (existsSync(join(cwd, 'nimi/.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml'))) {
    return join(cwd, 'nimi');
  }
  fail(`could not locate runtime RPC auth posture table from ${cwd}`);
};

const repoRoot = resolveRepoRoot();
const indexPath = join(repoRoot, '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml');
const tableRoot = join(repoRoot, '.nimi/spec/runtime/kernel/tables');
const sdkSourcePath = process.env.RUNTIME_RPC_AUTH_POSTURE_SDK_DRIFT_SDK_SOURCE
  ? resolve(process.env.RUNTIME_RPC_AUTH_POSTURE_SDK_DRIFT_SDK_SOURCE)
  : join(repoRoot, 'sdk/src/runtime/method-ids.ts');

if (!existsSync(sdkSourcePath)) {
  fail(`SDK source missing at ${sdkSourcePath}`);
}

const index = readYaml(indexPath);
if (index?.kind !== 'runtime-rpc-auth-posture') {
  fail(`${indexPath} must be kind=runtime-rpc-auth-posture`);
}
if (!Array.isArray(index.method_shards) || index.method_shards.length === 0) {
  fail(`${indexPath} must declare method_shards`);
}

const specAnonymousRead = new Set();
const specAllMethods = new Set();
const duplicateSpecMethods = [];

for (const shardRef of index.method_shards) {
  const shardPath = join(tableRoot, String(shardRef?.path || ''));
  if (!existsSync(shardPath)) {
    fail(`posture shard missing at ${shardPath}`);
  }
  const shard = readYaml(shardPath);
  if (shard?.kind !== 'runtime-rpc-auth-posture-shard') {
    fail(`${shardPath} must be kind=runtime-rpc-auth-posture-shard`);
  }
  if (!Array.isArray(shard.methods)) {
    fail(`${shardPath} must declare methods`);
  }
  for (const entry of shard.methods) {
    const methodId = String(entry?.method_id || '').trim();
    const posture = String(entry?.posture || '').trim();
    if (!methodId) {
      fail(`${shardPath} contains a method entry without method_id`);
    }
    if (specAllMethods.has(methodId)) {
      duplicateSpecMethods.push(methodId);
    }
    specAllMethods.add(methodId);
    if (posture === 'anonymous_read') {
      specAnonymousRead.add(methodId);
    }
  }
}

if (duplicateSpecMethods.length > 0) {
  fail(`duplicate method ids in runtime RPC auth posture shards:\n${duplicateSpecMethods.map((id) => `- ${id}`).join('\n')}`);
}

const source = readFileSync(sdkSourcePath, 'utf8');
const arrayBlockRe = /export\s+const\s+RuntimeAnonymousReadMethodIds\s*:\s*readonly\s+string\[\][^=]*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\)\s*;/;
const arrayMatch = arrayBlockRe.exec(source);
if (!arrayMatch) {
  fail(`RuntimeAnonymousReadMethodIds array not found in ${sdkSourcePath}`);
}

const sdkAnonymousRead = new Set();
const duplicateSdkMethods = [];
const literalRe = /'([^']+)'/g;
let literalMatch;
while ((literalMatch = literalRe.exec(arrayMatch[1])) !== null) {
  const methodId = literalMatch[1];
  if (sdkAnonymousRead.has(methodId)) {
    duplicateSdkMethods.push(methodId);
  }
  sdkAnonymousRead.add(methodId);
}

if (duplicateSdkMethods.length > 0) {
  fail(`duplicate method ids in RuntimeAnonymousReadMethodIds:\n${duplicateSdkMethods.map((id) => `- ${id}`).join('\n')}`);
}

const missing = [...specAnonymousRead].filter((methodId) => !sdkAnonymousRead.has(methodId)).sort();
const notClassified = [...sdkAnonymousRead].filter((methodId) => !specAnonymousRead.has(methodId)).sort();

if (missing.length > 0 || notClassified.length > 0) {
  const lines = [];
  if (missing.length > 0) {
    lines.push('missing anonymous_read method ids in SDK:');
    lines.push(...missing.map((methodId) => `- ${methodId}`));
  }
  if (notClassified.length > 0) {
    lines.push('SDK method ids not classified as anonymous_read in spec:');
    lines.push(...notClassified.map((methodId) => `- ${methodId}`));
  }
  fail(lines.join('\n'));
}

process.stdout.write(
  `[runtime-rpc-auth-posture-sdk-drift] ok: ${sdkAnonymousRead.size} anonymous_read method ids match spec\n`,
);
