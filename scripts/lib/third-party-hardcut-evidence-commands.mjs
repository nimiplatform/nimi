import fs from 'node:fs';
import path from 'node:path';

import {
  assertArtifactRef,
  assertExactObject,
  assertSchemaVersion,
  fail,
  readJsonLines,
} from './third-party-hardcut-evidence-core.mjs';
import { resolveAndVerifyPacketArtifact } from './third-party-hardcut-evidence-paths.mjs';

function parseNodeTapSummary(rawLog) {
  const readCount = (label) => {
    const pattern = new RegExp(`^# ${label} (\\d+)\\s*$`, 'gmu');
    const matches = [...rawLog.matchAll(pattern)];
    if (matches.length !== 1) {
      fail('COMMAND_LOG_UNPARSEABLE', 'raw command log lacks one native Node TAP summary');
    }
    return Number(matches[0][1]);
  };
  const summary = {
    tests: readCount('tests'),
    passed: readCount('pass'),
    failed: readCount('fail'),
    skipped: readCount('skipped'),
    cancelled: readCount('cancelled'),
    todo: readCount('todo'),
  };
  if (
    summary.tests !== summary.passed + summary.failed + summary.skipped + summary.todo
    || summary.cancelled !== 0
  ) {
    fail('COMMAND_LOG_MISMATCH', 'native Node TAP summary is internally inconsistent');
  }
  return summary;
}

export function validateCommandEvidence(
  artifactStore,
  commandsArtifact,
  contract,
  canonicalRepositories,
) {
  const commands = readJsonLines(commandsArtifact);
  for (const command of commands) {
    assertExactObject(
      command,
      contract.object_schemas.command_record.required_fields,
      `command record ${command.command_id ?? '<unknown>'}`,
    );
    assertSchemaVersion(command, contract.version, `command record ${command.command_id}`);
    assertExactObject(
      command.tests,
      contract.object_schemas.test_counts.required_fields,
      `command record ${command.command_id} test counts`,
    );
    assertArtifactRef(contract, command.log_ref, `command record ${command.command_id} log_ref`);
    if (
      typeof command.command_id !== 'string'
      || command.command_id.length === 0
      || typeof command.repository_id !== 'string'
      || command.repository_id.length === 0
      || typeof command.command !== 'string'
      || command.command.length === 0
      || Number.isNaN(Date.parse(command.started_at))
      || Number.isNaN(Date.parse(command.ended_at))
      || !Number.isInteger(command.exit_code)
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(command.committed_head)
      || !Array.isArray(command.unexpected_mutations)
      || typeof command.launched_real_shell !== 'boolean'
    ) {
      fail('INVALID_FIELD', `command record ${command.command_id} contains invalid typed metadata`);
    }
    if (
      typeof command.cwd !== 'string'
      || command.cwd.length === 0
      || path.isAbsolute(command.cwd)
      || command.cwd.split(/[\\/]/u).includes('..')
    ) {
      fail('COMMAND_CWD_INVALID', 'command cwd is not repository-relative');
    }
    const trustedRepository = canonicalRepositories.get(command.repository_id);
    const resolvedCwd = trustedRepository && path.resolve(trustedRepository, command.cwd);
    const relativeCwd = trustedRepository && path.relative(trustedRepository, resolvedCwd);
    let canonicalCwd;
    let cwdIsDirectory = false;
    try {
      canonicalCwd = resolvedCwd && fs.realpathSync(resolvedCwd);
      cwdIsDirectory = Boolean(canonicalCwd && fs.statSync(canonicalCwd).isDirectory());
    } catch {
      cwdIsDirectory = false;
    }
    const canonicalRelative = trustedRepository
      && canonicalCwd
      && path.relative(trustedRepository, canonicalCwd);
    if (
      !trustedRepository
      || path.isAbsolute(relativeCwd)
      || relativeCwd === '..'
      || relativeCwd.startsWith(`..${path.sep}`)
      || typeof canonicalRelative !== 'string'
      || path.isAbsolute(canonicalRelative)
      || canonicalRelative === '..'
      || canonicalRelative.startsWith(`..${path.sep}`)
      || !cwdIsDirectory
    ) {
      fail('COMMAND_CWD_INVALID', 'command cwd is outside the trusted repository');
    }
    if (Date.parse(command.ended_at) < Date.parse(command.started_at)) {
      fail('COMMAND_TIMELINE_INVALID', 'command ended before it started');
    }
    const logArtifact = resolveAndVerifyPacketArtifact(artifactStore, command.log_ref);
    const rawLog = logArtifact.bytes.toString('utf8');
    const observed = parseNodeTapSummary(rawLog);
    if (
      (command.exit_code === 0) !== (observed.failed === 0)
      || command.tests?.passed !== observed.passed
      || command.tests?.failed !== observed.failed
      || command.tests?.skipped !== observed.skipped
    ) {
      fail(
        'COMMAND_LOG_MISMATCH',
        `command record ${command.command_id} disagrees with its verified raw log`,
      );
    }
    if (command.output_truncated !== false) {
      fail('COMMAND_LOG_TRUNCATED', `command record ${command.command_id} has truncated output`);
    }
    if (command.unexpected_mutations.length > 0) {
      fail('UNEXPECTED_FILE_MUTATION', `command record ${command.command_id} observed file mutations`);
    }
  }
  return commands;
}
