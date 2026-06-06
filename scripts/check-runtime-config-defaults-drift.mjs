#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function specDefaultFor(fields, key) {
  const field = fields.find((item) => item?.key === key);
  if (!field) {
    throw new Error(`missing runtime config schema field: ${key}`);
  }
  return String(field.default ?? '');
}

function sdkDefaultFor(source, key) {
  const pattern = key === 'schemaVersion'
    ? new RegExp(`${key}:\\s*(\\d+)`)
    : new RegExp(`${key}:\\s*'([^']+)'`);
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`missing SDK runtime bridge config default: ${key}`);
  }
  return String(match[1]);
}

function main() {
  const spec = YAML.parse(read('.nimi/spec/runtime/kernel/tables/config-schema.yaml')) || {};
  const fields = Array.isArray(spec.fields) ? spec.fields : [];
  const sdkSource = read('sdks/typescript/runtime/bridge-config.ts');
  const keys = ['schemaVersion', 'grpcAddr', 'httpAddr'];
  const mismatches = [];

  for (const key of keys) {
    const specDefault = specDefaultFor(fields, key);
    const sdkDefault = sdkDefaultFor(sdkSource, key);
    if (specDefault !== sdkDefault) {
      mismatches.push(`${key}: spec=${JSON.stringify(specDefault)} sdk=${JSON.stringify(sdkDefault)}`);
    }
  }

  if (mismatches.length > 0) {
    process.stderr.write('runtime config default drift detected:\n');
    for (const mismatch of mismatches) {
      process.stderr.write(`- ${mismatch}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`runtime config defaults drift check passed (${keys.length} fields)\n`);
}

main();
