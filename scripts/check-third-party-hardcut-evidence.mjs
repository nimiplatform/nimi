#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEvidenceContract } from './lib/third-party-hardcut-evidence-contract.mjs';
import { EvidenceValidationError, fail } from './lib/third-party-hardcut-evidence-core.mjs';
import { validateEvidencePacket } from './lib/third-party-hardcut-evidence-validator.mjs';

function readArguments(argv) {
  const options = { repos: new Map() };
  let separatorSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      if (separatorSeen || index !== 0) {
        fail('ARGUMENT_ERROR', 'usage: check-third-party-hardcut-evidence --packet <path> --repo <id=path>');
      }
      separatorSeen = true;
      continue;
    }
    if (argument === '--packet') {
      if (options.packet || !argv[index + 1] || argv[index + 1].startsWith('--')) {
        fail('ARGUMENT_ERROR', 'usage: check-third-party-hardcut-evidence --packet <path> --repo <id=path>');
      }
      options.packet = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--repo') {
      const value = argv[index + 1] ?? '';
      const separator = value.indexOf('=');
      const repoId = value.slice(0, separator);
      if (
        separator <= 0
        || separator === value.length - 1
        || !/^[a-z][a-z0-9._-]*$/u.test(repoId)
        || options.repos.has(repoId)
      ) {
        fail('ARGUMENT_ERROR', 'usage: check-third-party-hardcut-evidence --packet <path> --repo <id=path>');
      }
      options.repos.set(repoId, path.resolve(value.slice(separator + 1)));
      index += 1;
      continue;
    }
    fail('ARGUMENT_ERROR', 'usage: check-third-party-hardcut-evidence --packet <path> --repo <id=path>');
  }
  if (!options.packet || options.repos.size === 0) {
    fail('ARGUMENT_ERROR', 'usage: check-third-party-hardcut-evidence --packet <path> --repo <id=path>');
  }
  return options;
}

function main() {
  const options = readArguments(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const contract = loadEvidenceContract(
    path.join(scriptDir, '..', '.nimi', 'contracts', 'third-party-hardcut-evidence.schema.yaml'),
  );
  const result = validateEvidencePacket({
    contract,
    packetRoot: path.resolve(options.packet),
    trustedRepos: options.repos,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  if (error instanceof EvidenceValidationError) {
    const detail = error.code === 'ARGUMENT_ERROR'
      ? error.message
      : 'validation rejected';
    process.stderr.write(`[${error.code}] ${detail}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write('[VALIDATOR_ERROR] validation failed without a typed rejection\n');
    process.exitCode = 1;
  }
}
