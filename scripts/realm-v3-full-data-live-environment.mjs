#!/usr/bin/env node

import process from 'node:process';

import {
  cleanupLiveEnvironment,
  execInLiveEnvironment,
  prepareLiveEnvironment,
  statusLiveEnvironment,
} from './lib/realm-v3-full-data-live-environment.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/realm-v3-full-data-live-environment.mjs prepare [options]',
    '  node scripts/realm-v3-full-data-live-environment.mjs exec [options] -- <command> [args...]',
    '  node scripts/realm-v3-full-data-live-environment.mjs status --state-dir <abs>',
    '  node scripts/realm-v3-full-data-live-environment.mjs cleanup [options]',
    '',
    'Prepare options:',
    '  --root-realm <abs>                    Read-only Root Realm repository.',
    '  --dependency-root <abs>                Read-only dependency cache/root identity.',
    '  --state-dir <abs>                      uid-owned 0700 random directory under OS tmp.',
    '  --attestation-out <abs>                Sanitized attestation outside state-dir.',
    '  --child-registration <abs>              Closed child + docker/git/go/pnpm/ps/tar registration.',
    '  --persistent-postgres-container <name> Existing PostgreSQL container.',
    '  --postgres-user <name>                 PostgreSQL role used by read-only census/admin clone.',
    '  --persistent-database nimi_dev         Required immutable source database.',
    '  --redis-image <name@sha256:digest>     Content-addressed Redis image.',
    '  --api-port <1..65535>                  Optional fixed loopback API port.',
    '',
    'Cleanup-only options:',
    '  --attestation <abs>                    Prepared live attestation.',
    '  --run-lock <abs>                       Final frozen N7 run-lock.',
    '  --close-candidate <abs>                 Passing pre-cleanup close candidate.',
    '  --receipt-out <abs>                    Cleanup receipt outside state-dir.',
    '  Omit all four cleanup-only bindings only to clean an interrupted partial prepare; no PASS receipt is issued.',
    '',
    'Exec options:',
    '  --state-dir <abs>                       Prepared uid-owned private state directory.',
    '  --stage census|partition                Registered child stage.',
    '  --partition <safe-id>                   Stage/ordinal/partition-key execution identity.',
    '  --execution-receipt-out <abs>           Unique admitted Nimi .nimi/local receipt path.',
    'Exec emits no stdout; credentials are injected only after wrapper/child identity verification.',
    'Prepare additionally requires NIMI_REALM_V3_FULL_LIVE_PERSISTENT_DATABASE_URL targeting loopback nimi_dev.',
  ].join('\n');
}

function parseOptions(tokens, admitted, flags = new Set()) {
  const result = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument ${token}`);
    const key = admitted.get(token);
    if (!key) throw new Error(`unknown option ${token}`);
    if (flags.has(token)) {
      result[key] = true;
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} requires a value`);
    if (Object.hasOwn(result, key)) throw new Error(`${token} was repeated`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function requireOptions(options, names) {
  for (const name of names) {
    if (!options[name]) throw new Error(`missing required option ${name}`);
  }
}

const common = new Map([
  ['--state-dir', 'stateDirectory'],
  ['--root-realm', 'rootRealm'],
  ['--persistent-postgres-container', 'persistentPostgresContainer'],
  ['--postgres-user', 'postgresUser'],
]);

async function run() {
  const [command, ...remaining] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'prepare') {
    const options = parseOptions(remaining, new Map([
      ...common,
      ['--dependency-root', 'dependencyRoot'],
      ['--attestation-out', 'attestationOutput'],
      ['--child-registration', 'childRegistrationPath'],
      ['--persistent-database', 'persistentDatabase'],
      ['--redis-image', 'redisImage'],
      ['--api-port', 'apiPort'],
    ]));
    requireOptions(options, [
      'rootRealm',
      'dependencyRoot',
      'stateDirectory',
      'attestationOutput',
      'childRegistrationPath',
      'persistentPostgresContainer',
      'postgresUser',
      'persistentDatabase',
      'redisImage',
    ]);
    if (options.apiPort !== undefined) options.apiPort = Number(options.apiPort);
    const result = await prepareLiveEnvironment(options);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: result.attestation.schemaVersion,
      status: result.attestation.status,
      resumed: result.resumed,
      environmentAttestationDigest: result.attestation.contentHash,
      serverExportAttestationDigest: result.attestation.export.serverExportAttestationDigest,
      canonicalRealmBaseURL: result.attestation.service.canonicalRealmBaseURL,
      canonicalTokenURL: result.attestation.service.canonicalTokenURL,
      expectedIssuer: result.attestation.service.expectedIssuer,
    })}\n`);
    return;
  }
  if (command === 'status') {
    const options = parseOptions(remaining, new Map([['--state-dir', 'stateDirectory']]));
    requireOptions(options, ['stateDirectory']);
    process.stdout.write(`${JSON.stringify(await statusLiveEnvironment(options))}\n`);
    return;
  }
  if (command === 'cleanup') {
    const options = parseOptions(remaining, new Map([
      ...common,
      ['--attestation', 'attestationPath'],
      ['--run-lock', 'runLockPath'],
      ['--close-candidate', 'closeCandidatePath'],
      ['--receipt-out', 'receiptOutput'],
    ]));
    requireOptions(options, [
      'stateDirectory',
      'rootRealm',
      'persistentPostgresContainer',
      'postgresUser',
    ]);
    const finalBindings = ['attestationPath', 'runLockPath', 'closeCandidatePath', 'receiptOutput'];
    const supplied = finalBindings.filter((name) => options[name]);
    if (supplied.length !== 0 && supplied.length !== finalBindings.length) {
      throw new Error('cleanup requires either all or none of --attestation/--run-lock/--close-candidate/--receipt-out');
    }
    const receipt = await cleanupLiveEnvironment(options);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      status: receipt.status,
      environmentAttestationDigest: receipt.environmentAttestationDigest ?? null,
      runInputDigest: receipt.runInputDigest ?? null,
      closeCandidateDigest: receipt.closeCandidateDigest ?? null,
      contentHash: receipt.contentHash,
    })}\n`);
    return;
  }
  if (command === 'exec') {
    const separator = remaining.indexOf('--');
    if (separator < 0 || separator === remaining.length - 1) {
      throw new Error('exec requires -- <command> [args...]');
    }
    const optionTokens = remaining.slice(0, separator);
    const childTokens = remaining.slice(separator + 1);
    const options = parseOptions(optionTokens, new Map([
      ['--state-dir', 'stateDirectory'],
      ['--stage', 'stage'],
      ['--partition', 'partition'],
      ['--execution-receipt-out', 'executionReceiptOutput'],
    ]));
    requireOptions(options, ['stateDirectory', 'stage', 'partition', 'executionReceiptOutput']);
    await execInLiveEnvironment(options, childTokens[0], childTokens.slice(1));
    return;
  }
  throw new Error(`unknown command ${command}`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`realm-v3-full-data-live-environment: ${message}\n\n${usage()}\n`);
  process.exitCode = 1;
}
