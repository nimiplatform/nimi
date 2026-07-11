import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { loadEvidenceContract } from './lib/third-party-hardcut-evidence-contract.mjs';
import {
  assertRepositoryStateStable,
  captureRepositoryState,
} from './lib/third-party-hardcut-evidence-repositories.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(scriptDir, 'check-third-party-hardcut-evidence.mjs');
const contractPath = path.join(
  scriptDir,
  '..',
  '.nimi',
  'contracts',
  'third-party-hardcut-evidence.schema.yaml',
);
const testdataRoot = path.join(
  scriptDir,
  'testdata',
  'third-party-hardcut-evidence',
);
const repoRoot = path.join(scriptDir, '..');
const CANONICAL_RESOURCE_POLICY = {
  version: 1,
  path_key_collision_posture: 'reject',
  max_file_count: 512,
  max_entry_count: 1024,
  max_directory_depth: 32,
  max_single_file_bytes: 16 * 1024 * 1024,
  max_packet_total_bytes: 128 * 1024 * 1024,
  max_text_scan_bytes: 4 * 1024 * 1024,
  max_screenshot_compressed_bytes: 16 * 1024 * 1024,
  stream_chunk_bytes: 64 * 1024,
};

function runPacketPath(packetPath, extraArgs = [], spawnOptions = {}) {
  return spawnSync(
    process.execPath,
    [
      cliPath,
      '--packet',
      packetPath,
      ...extraArgs,
    ],
    { encoding: 'utf8', ...spawnOptions },
  );
}

function runCli(args, spawnOptions = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', ...spawnOptions });
}

function runPacket(relativePacketPath, extraArgs = []) {
  const hasRepo = extraArgs.includes('--repo');
  return runPacketPath(
    path.join(testdataRoot, relativePacketPath),
    hasRepo ? extraArgs : [...extraArgs, '--repo', `nimi=${repoRoot}`],
  );
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function makePng(width, height, pixel = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rowLength = width * 3 + 1;
  const pixels = Buffer.alloc(rowLength * height, pixel);
  for (let row = 0; row < height; row += 1) pixels[row * rowLength] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeOversizedPngHeader(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makePngWithOpaqueAncillaryData() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const opaque = Buffer.alloc(4096);
  let state = 0x6d2b79f5;
  for (let index = 0; index < opaque.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    opaque[index] = state & 0xff;
  }
  Buffer.from('"token":', 'utf8').copy(opaque, 1024);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('vpAg', opaque),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 17, 34, 51]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makePngWithInternationalTextKeyword(keyword) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const internationalText = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0]),
    Buffer.from('en', 'ascii'),
    Buffer.from([0]),
    Buffer.from('safe label', 'utf8'),
    Buffer.from([0]),
    Buffer.from('safe payload', 'utf8'),
  ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('iTXt', internationalText),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 17, 34, 51]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function refreshManifestRefs(packetRoot, fields) {
  const manifestPath = path.join(packetRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [field, artifactName] of Object.entries(fields)) {
    manifest[field].sha256 = sha256(path.join(packetRoot, artifactName));
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function runGit(repoPath, args) {
  const result = spawnSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function snapshotFiles(root) {
  const snapshot = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath, { bigint: true });
        snapshot[path.relative(root, fullPath)] = {
          sha256: sha256(fullPath),
          size: stat.size,
          mtimeNs: stat.mtimeNs,
        };
      }
    }
  };
  visit(root);
  return snapshot;
}

function materializeValidPacket() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-hardcut-evidence-'));
  const packetRoot = path.join(tempRoot, 'packet');
  const trustedRepo = path.join(tempRoot, 'trusted-repo');
  fs.cpSync(path.join(testdataRoot, 'valid-implementation-incomplete'), packetRoot, {
    filter(source) {
      return path.basename(source) !== 'command.log';
    },
    recursive: true,
  });
  fs.mkdirSync(trustedRepo);
  runGit(trustedRepo, ['init', '--initial-branch=develop']);
  runGit(trustedRepo, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(trustedRepo, ['config', 'user.name', 'Evidence Fixture']);
  fs.writeFileSync(path.join(trustedRepo, 'tracked.txt'), 'trusted fixture repository\n');
  runGit(trustedRepo, ['add', 'tracked.txt']);
  runGit(trustedRepo, ['commit', '-m', 'fixture baseline']);
  const head = runGit(trustedRepo, ['rev-parse', 'HEAD']);

  const baselinePath = path.join(packetRoot, 'execution-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  baseline.repositories[0].head = head;
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);

  const commandsPath = path.join(packetRoot, 'commands.jsonl');
  const command = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
  command.committed_head = head;
  fs.writeFileSync(commandsPath, `${JSON.stringify(command)}\n`);

  const manifestPath = path.join(packetRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.baseline_ref.sha256 = sha256(baselinePath);
  manifest.commands_ref.sha256 = sha256(commandsPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { packetRoot, tempRoot, trustedRepo };
}

function materializeValidLivePacket() {
  const fixture = materializeValidPacket();
  const write = (name, value) => {
    const filePath = path.join(fixture.packetRoot, name);
    fs.writeFileSync(filePath, value);
    return { path: name, sha256: sha256(filePath) };
  };
  const domRef = write('dom.json', '{"schema_version":1,"observations":["main-visible"]}\n');
  const accessibilityRef = write('accessibility.json', '{"schema_version":1,"violations":[]}\n');
  const desktopRef = write('desktop.png', makePng(1440, 900, 255));
  const narrowRef = write('narrow.png', makePng(390, 844, 0));
  const actionDomRef = write('action-dom.json', '{"schema_version":1,"observed_state":"setup-required"}\n');
  const failureRef = write('failure.log', 'runtime unavailable state observed\n');
  const faultRef = write('fault.log', 'realm disconnect and recovery observed\n');
  const leakProbeRef = {
    path: 'leak-report.json',
    sha256: sha256(path.join(fixture.packetRoot, 'leak-report.json')),
  };
  const liveReport = {
    schema_version: 1,
    row_id: 'A-11',
    shell_id: 'tester-tauri',
    execution_status: 'executed',
    executable: { name: 'fixture-tauri.exe', process_id: 4242, shell_type: 'tauri' },
    launch: { posture: 'desktop-installed', authority: 'runtime-open-app' },
    caller: {
      observed_by: 'runtime',
      mode: 'desktop-launched-nimi-app',
      app_id: 'fixture.tester',
      release_ref: 'release-fixture',
      capability_refs: ['realm.fixture'],
      session_generation: 1,
      app_instance_id: 'instance-fixture',
      device_id: 'device-fixture',
      grant_generation: 1,
      release_generation: 1,
      account_generation: 1,
    },
    runtime: {
      executable_name: 'fixture-runtime.exe',
      executable_sha256: '1111111111111111111111111111111111111111111111111111111111111111',
      process_id: 4343,
      generation: 1,
      endpoint_class: 'local-grpc',
      health_observed: true,
      realm_connection_observed: true,
    },
    actions: [{
      id: 'open-settings',
      occurred_at: '2026-07-10T00:00:02.000Z',
      state: 'setup-required',
      dom_observation_ref: actionDomRef,
    }],
    failure_states: [{ state: 'runtime-unavailable', observed: true, source_ref: failureRef }],
    faults: [{
      kind: 'realm-disconnect',
      injected_at: '2026-07-10T00:00:03.000Z',
      recovery_observed: true,
      source_ref: faultRef,
    }],
    leak_probe_ref: leakProbeRef,
    ui: {
      dom_ref: domRef,
      accessibility_ref: accessibilityRef,
      viewports: [
        { id: 'desktop', kind: 'desktop', width: 1440, height: 900 },
        { id: 'narrow', kind: 'narrow', width: 390, height: 844 },
      ],
      screenshots: [
        {
          viewport_id: 'desktop',
          artifact_ref: desktopRef,
          captured_at: '2026-07-10T00:00:04.000Z',
          width: 1440,
          height: 900,
        },
        {
          viewport_id: 'narrow',
          artifact_ref: narrowRef,
          captured_at: '2026-07-10T00:00:05.000Z',
          width: 390,
          height: 844,
        },
      ],
    },
    console_errors: [],
    page_errors: [],
  };
  const liveReportRef = write('live-shell-report.json', `${JSON.stringify(liveReport, null, 2)}\n`);
  const coveragePath = path.join(fixture.packetRoot, 'coverage.jsonl');
  fs.writeFileSync(coveragePath, `${JSON.stringify({
    schema_version: 1,
    row_id: 'A-11',
    execution_status: 'executed',
    raw_artifact_refs: [],
    shell_report_ref: liveReportRef,
  })}\n`);
  const manifestPath = path.join(fixture.packetRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.wave = 'A';
  manifest.coverage_ref.sha256 = sha256(coveragePath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return fixture;
}

function rewriteLiveReport(fixture, mutate) {
  const reportPath = path.join(fixture.packetRoot, 'live-shell-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  mutate(report);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const coveragePath = path.join(fixture.packetRoot, 'coverage.jsonl');
  const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  coverage.shell_report_ref.sha256 = sha256(reportPath);
  fs.writeFileSync(coveragePath, `${JSON.stringify(coverage)}\n`);
  refreshManifestRefs(fixture.packetRoot, { coverage_ref: 'coverage.jsonl' });
}

function rowIds(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(2, '0')}`,
  );
}

test('contract tracks every stable required row while v1 refuses success derivation', () => {
  const contract = loadEvidenceContract(contractPath);
  const actualRows = Object.values(contract.required_row_registry.waves).flat().sort();
  const expectedRows = [
    ...rowIds('G', 7),
    ...rowIds('A', 25),
    'A-08b',
    ...rowIds('U', 13),
    ...rowIds('R', 13),
    ...rowIds('B', 21),
    ...rowIds('C', 3),
  ].sort();

  assert.equal(contract.required_row_registry.version, 1);
  assert.deepEqual(actualRows, expectedRows);
  assert.equal(contract.required_row_registry.waves.A.length, 26);
  assert.equal(contract.prohibited_material_registry.version, 1);
  assert.equal(contract.prohibited_material_registry.classes.length, 15);
  assert.deepEqual(contract.packet_resource_policy, CANONICAL_RESOURCE_POLICY);
  assert.equal(contract.admission_derivation.admitted_and_observed.supported, false);
  assert.deepEqual(contract.enforced_required_rows.phase0, []);
  assert.deepEqual(
    contract.object_schemas.manifest.required_fields.filter((field) => (
      ['generated_at', 'timezone', 'authority_refs'].includes(field)
    )),
    ['generated_at', 'timezone', 'authority_refs'],
  );
});

test('CLI applies the canonical single-file limit before validation reads', () => {
  const fixture = materializeValidPacket();
  try {
    const oversized = path.join(fixture.packetRoot, 'canonical-oversized.bin');
    fs.writeFileSync(oversized, '');
    fs.truncateSync(oversized, CANONICAL_RESOURCE_POLICY.max_single_file_bytes + 1);
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '[PACKET_FILE_TOO_LARGE] validation rejected\n');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('CLI applies the canonical aggregate packet limit before validation reads', () => {
  const fixture = materializeValidPacket();
  try {
    for (let index = 0; index < 8; index += 1) {
      const candidate = path.join(fixture.packetRoot, `aggregate-${index}.bin`);
      fs.writeFileSync(candidate, '');
      fs.truncateSync(candidate, CANONICAL_RESOURCE_POLICY.max_single_file_bytes);
    }
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '[PACKET_TOTAL_TOO_LARGE] validation rejected\n');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('CLI applies canonical entry-count and directory-depth limits to empty directories', () => {
  const cases = [
    {
      code: 'PACKET_ENTRY_COUNT_EXCEEDED',
      prepare(root) {
        for (let index = 0; index < CANONICAL_RESOURCE_POLICY.max_entry_count; index += 1) {
          fs.mkdirSync(path.join(root, `wide-${index}`));
        }
      },
    },
    {
      code: 'PACKET_DIRECTORY_DEPTH_EXCEEDED',
      prepare(root) {
        let cursor = root;
        for (let depth = 0; depth <= CANONICAL_RESOURCE_POLICY.max_directory_depth; depth += 1) {
          cursor = path.join(cursor, 'd');
          fs.mkdirSync(cursor);
        }
      },
    },
  ];
  for (const entry of cases) {
    const fixture = materializeValidPacket();
    try {
      entry.prepare(fixture.packetRoot);
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );
      assert.equal(result.status, 1);
      assert.equal(result.stderr, `[${entry.code}] validation rejected\n`);
      assert.doesNotMatch(result.stderr, /wide-|\\d(?:\\d)*$/u);
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('package exposes the read-only evidence checker command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts['check:third-party-hardcut-evidence'],
    'node scripts/check-third-party-hardcut-evidence.mjs',
  );
});

test('pnpm package command accepts the minimal packet only as incomplete', () => {
  const fixture = materializeValidPacket();
  try {
    const pnpmArgs = [
      'check:third-party-hardcut-evidence',
      '--',
      '--packet', fixture.packetRoot,
      '--repo', `nimi=${fixture.trustedRepo}`,
    ];
    const pnpmCli = process.platform === 'win32'
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
      : null;
    const result = spawnSync(
      pnpmCli ? process.execPath : 'pnpm',
      pnpmCli ? [pnpmCli, ...pnpmArgs] : pnpmArgs,
      { cwd: repoRoot, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    const outputLine = result.stdout.trim().split(/\r?\n/u).at(-1);
    const output = JSON.parse(outputLine);
    assert.equal(output.disposition, 'implementation_incomplete');
    assert.deepEqual(output.coverage.observed_rows, []);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('CLI rejects missing, unknown, duplicate, and contract override arguments', () => {
  const cases = [
    [],
    ['--unknown'],
    ['--packet', 'one', '--packet', 'two'],
    ['--packet', 'one', '--repo', 'nimi=one', '--repo', 'nimi=two'],
    ['--contract', contractPath, '--packet', 'one'],
    ['--max-entry-count', '2048'],
    ['--max-directory-depth', '64'],
    ['--', '--', '--packet', 'one', '--repo', 'nimi=one'],
    ['--packet', 'one', '--', '--repo', 'nimi=one'],
    ['--packet', 'one', '--repo'],
    ['--packet'],
    ['--packet', 'one', '--repo', 'nimi='],
    ['--packet', 'one', '--repo', 'bad id=one'],
  ];
  for (const args of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[ARGUMENT_ERROR\] /u);
    assert.match(result.stderr, /usage: check-third-party-hardcut-evidence/u);
    assert.doesNotMatch(result.stderr, /[A-Za-z]:\\|\/Users\/|\/home\//u);
  }
});

test('trusted repo probes reject packet-local, subdirectory, and unknown repositories', () => {
  const fixture = materializeValidPacket();
  try {
    const nested = path.join(fixture.trustedRepo, 'nested');
    fs.mkdirSync(nested);
    const cases = [
      {
        args: ['--repo', `nimi=${fixture.packetRoot}`],
        code: 'REPOSITORY_PATH_INVALID',
      },
      {
        args: ['--repo', `nimi=${nested}`],
        code: 'REPOSITORY_PATH_INVALID',
      },
      {
        args: [
          '--repo', `nimi=${fixture.trustedRepo}`,
          '--repo', `extra=${fixture.trustedRepo}`,
        ],
        code: 'UNKNOWN_REPOSITORY_PROBE',
      },
    ];
    for (const entry of cases) {
      const result = runPacketPath(fixture.packetRoot, entry.args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^\\[${entry.code}\\]`, 'u'));
    }
    const baselinePath = path.join(fixture.packetRoot, 'execution-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baseline.repositories.push({ ...baseline.repositories[0], id: 'secondary' });
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    const manifestPath = path.join(fixture.packetRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.baseline_ref.sha256 = sha256(baselinePath);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const aliasResult = runPacketPath(fixture.packetRoot, [
      '--repo', `nimi=${fixture.trustedRepo}`,
      '--repo', `secondary=${fixture.trustedRepo}`,
    ]);
    assert.equal(aliasResult.status, 1);
    assert.match(aliasResult.stderr, /^\[DUPLICATE_REPOSITORY_PATH\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('repository IDs are unique and use the same trusted syntax as CLI IDs', () => {
  const cases = [
    {
      mutate(baseline) {
        baseline.repositories.push({ ...baseline.repositories[0] });
      },
      code: 'DUPLICATE_REPOSITORY',
    },
    {
      mutate(baseline) {
        baseline.repositories[0].id = 'bad id';
      },
      code: 'INVALID_FIELD',
    },
  ];
  for (const entry of cases) {
    const fixture = materializeValidPacket();
    try {
      const baselinePath = path.join(fixture.packetRoot, 'execution-baseline.json');
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      entry.mutate(baseline);
      fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
      refreshManifestRefs(fixture.packetRoot, { baseline_ref: 'execution-baseline.json' });
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^\\[${entry.code}\\]`, 'u'));
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('one leading pnpm separator and a canonical repo-root junction are accepted', () => {
  const fixture = materializeValidPacket();
  try {
    const repoAlias = path.join(fixture.tempRoot, 'trusted-repo-alias');
    fs.symlinkSync(fixture.trustedRepo, repoAlias, 'junction');
    const result = runCli([
      '--',
      '--packet', fixture.packetRoot,
      '--repo', `nimi=${repoAlias}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).disposition, 'implementation_incomplete');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('contract loader rejects unknown nested fields and tampered structural adapters', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-hardcut-contract-'));
  try {
    const canonical = fs.readFileSync(contractPath, 'utf8');
    const cases = [
      canonical.replace('  caller_mode:', '  passed: true\n  caller_mode:'),
      canonical.replace(
        '  A-11:\n    evidence_kind: live_shell',
        '  A-11:\n    evidence_kind: command',
      ),
      canonical.replace('    shell_type: null', '    shell_type: .nan'),
    ];
    for (const [index, body] of cases.entries()) {
      const candidate = path.join(tempRoot, `contract-${index}.yaml`);
      fs.writeFileSync(candidate, body);
      assert.throws(
        () => loadEvidenceContract(candidate),
        (error) => ['UNKNOWN_FIELD', 'CONTRACT_INVALID'].includes(error.code),
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('accepts the minimal packet only as implementation_incomplete and stays read-only', () => {
  const fixture = materializeValidPacket();
  try {
    const before = snapshotFiles(fixture.packetRoot);
    const repositoryBefore = snapshotFiles(fixture.trustedRepo);
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );
    const after = snapshotFiles(fixture.packetRoot);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(after, before);
    assert.deepEqual(snapshotFiles(fixture.trustedRepo), repositoryBefore);
    assert.equal(fs.existsSync(path.join(fixture.packetRoot, 'closeout.json')), false);
    const output = JSON.parse(result.stdout);
    assert.equal(output.packet_id, 'fixture-valid-implementation-incomplete');
    assert.equal(output.disposition, 'implementation_incomplete');
    assert.equal(output.admitted_and_observed_supported, false);
    assert.deepEqual(output.coverage.observed_rows, []);
    assert.deepEqual(output.coverage.structural_claim_rows, ['C-02']);
    assert.deepEqual(output.privacy, {
      recognized_text_scan_performed: true,
      binary_exact_canary_scan_performed: true,
      structured_probe_claims_observed: false,
      ocr_supported: false,
    });
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('validates complete live-shell structure without promoting Wave A to success', () => {
  const fixture = materializeValidLivePacket();
  try {
    const before = snapshotFiles(fixture.packetRoot);
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshotFiles(fixture.packetRoot), before);
    const output = JSON.parse(result.stdout);
    assert.equal(output.disposition, 'implementation_incomplete');
    assert.equal(output.admitted_and_observed_supported, false);
    assert.deepEqual(output.coverage.observed_rows, []);
    assert.deepEqual(output.coverage.structural_claim_rows, ['A-11']);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects screenshot bytes with invalid image magic or false dimensions', () => {
  const cases = [
    {
      body: Buffer.from('not an image\n'),
      code: 'SCREENSHOT_INVALID',
    },
    {
      body: Buffer.from('P6\n1 1\n255\n\x00\x00\x00', 'binary'),
      code: 'SCREENSHOT_DIMENSION_MISMATCH',
    },
    {
      body: makeOversizedPngHeader(100_000, 100_000),
      code: 'SCREENSHOT_TOO_LARGE',
    },
  ];
  for (const entry of cases) {
    const fixture = materializeValidLivePacket();
    try {
      const screenshotPath = path.join(fixture.packetRoot, 'desktop.png');
      fs.writeFileSync(screenshotPath, entry.body);
      rewriteLiveReport(fixture, (report) => {
        report.ui.screenshots[0].artifact_ref.sha256 = sha256(screenshotPath);
      });
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^\\[${entry.code}\\]`, 'u'));
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('rejects a self-asserted admitted disposition', () => {
  const result = runPacket(path.join('negative', 'self-asserted-pass'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[SELF_ASSERTED_DISPOSITION\]/u);
});

test('rejects a missing packet-relative raw artifact', () => {
  const result = runPacket(path.join('negative', 'missing-raw-artifact'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[RAW_ARTIFACT_MISSING\]/u);
});

test('rejects a raw artifact reference outside the packet', () => {
  const result = runPacket(path.join('negative', 'outside-packet-artifact'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[RAW_ARTIFACT_OUTSIDE_PACKET\]/u);
});

test('rejects a packet artifact that escapes through a directory symlink', () => {
  const fixture = materializeValidPacket();
  try {
    const outsideRoot = path.join(fixture.tempRoot, 'outside');
    fs.mkdirSync(outsideRoot);
    const outsideBaseline = path.join(outsideRoot, 'baseline.json');
    fs.writeFileSync(outsideBaseline, '{"schema_version":1,"repositories":[]}\n');
    fs.symlinkSync(outsideRoot, path.join(fixture.packetRoot, 'escape'), 'junction');
    const manifestPath = path.join(fixture.packetRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.baseline_ref = { path: 'escape/baseline.json', sha256: sha256(outsideBaseline) };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[RAW_ARTIFACT_REPARSE_POINT\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects an unreferenced packet junction instead of skipping it during privacy scan', () => {
  const fixture = materializeValidPacket();
  try {
    const outsideRoot = path.join(fixture.tempRoot, 'unreferenced-outside');
    fs.mkdirSync(outsideRoot);
    fs.writeFileSync(path.join(outsideRoot, 'opaque.bin'), Buffer.from([0, 1, 2, 3]));
    fs.symlinkSync(outsideRoot, path.join(fixture.packetRoot, 'unreferenced-junction'), 'junction');

    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[RAW_ARTIFACT_REPARSE_POINT\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects a packet artifact identity swap between path check and handle read', () => {
  const fixture = materializeValidPacket();
  try {
    const targetPath = path.join(fixture.packetRoot, 'command.tap');
    const hookPath = path.join(fixture.tempRoot, 'swap-open-hook.cjs');
    fs.writeFileSync(hookPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const originalOpen = fs.openSync;',
      'const target = path.resolve(process.env.NIMI_SWAP_TARGET);',
      'let swapped = false;',
      'fs.openSync = function hookedOpen(candidate, ...args) {',
      "  if (!swapped && typeof candidate === 'string' && path.resolve(candidate) === target) {",
      '    swapped = true;',
      "    const original = `${target}.original`;",
      '    fs.renameSync(target, original);',
      '    fs.copyFileSync(original, target);',
      '  }',
      '  return originalOpen.call(this, candidate, ...args);',
      '};',
      '',
    ].join('\n'));
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
      {
        env: {
          ...process.env,
          NIMI_SWAP_TARGET: targetPath,
          NODE_OPTIONS: `--require=${hookPath}`,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[ARTIFACT_IDENTITY_CHANGED\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('opens each packet file exactly once and reuses its verified bytes', () => {
  const fixture = materializeValidPacket();
  try {
    const hookPath = path.join(fixture.tempRoot, 'count-open-hook.cjs');
    const countsPath = path.join(fixture.tempRoot, 'open-counts.json');
    fs.writeFileSync(hookPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const originalOpen = fs.openSync;',
      'const root = path.resolve(process.env.NIMI_COUNT_ROOT);',
      'const counts = new Map();',
      'fs.openSync = function countedOpen(candidate, ...args) {',
      "  if (typeof candidate === 'string') {",
      '    const absolute = path.resolve(candidate);',
      '    const relative = path.relative(root, absolute);',
      "    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {",
      '      counts.set(relative, (counts.get(relative) ?? 0) + 1);',
      '    }',
      '  }',
      '  return originalOpen.call(this, candidate, ...args);',
      '};',
      "process.on('exit', () => {",
      '  fs.writeFileSync(process.env.NIMI_COUNT_OUTPUT, JSON.stringify(Object.fromEntries(counts)));',
      '});',
      '',
    ].join('\n'));
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
      {
        env: {
          ...process.env,
          NIMI_COUNT_ROOT: fixture.packetRoot,
          NIMI_COUNT_OUTPUT: countsPath,
          NODE_OPTIONS: `--require=${hookPath}`,
        },
      },
    );
    const counts = JSON.parse(fs.readFileSync(countsPath, 'utf8'));
    const packetFiles = Object.keys(snapshotFiles(fixture.packetRoot));

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Object.keys(counts).sort(), packetFiles.sort());
    assert.equal(Object.values(counts).every((count) => count === 1), true);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('repository probes do not refresh a stale Git index', () => {
  const fixture = materializeValidPacket();
  try {
    const trackedPath = path.join(fixture.trustedRepo, 'tracked.txt');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(trackedPath, future, future);
    const indexResult = runGit(fixture.trustedRepo, ['rev-parse', '--git-path', 'index']);
    const indexPath = path.isAbsolute(indexResult)
      ? indexResult
      : path.resolve(fixture.trustedRepo, indexResult);
    const beforeStat = fs.statSync(indexPath, { bigint: true });
    const beforeHash = sha256(indexPath);

    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );
    const afterStat = fs.statSync(indexPath, { bigint: true });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(sha256(indexPath), beforeHash);
    assert.equal(afterStat.mtimeNs, beforeStat.mtimeNs);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects trusted repository HEAD or status changes across validation', () => {
  const fixture = materializeValidPacket();
  try {
    const state = captureRepositoryState(fixture.trustedRepo);
    fs.appendFileSync(
      path.join(fixture.trustedRepo, 'tracked.txt'),
      'changed during validation\n',
    );
    assert.throws(
      () => assertRepositoryStateStable(new Map([['nimi', state]])),
      (error) => error.code === 'REPOSITORY_STATE_CHANGED',
    );
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects a mismatched SHA-256 before parsing an artifact', () => {
  const result = runPacket(path.join('negative', 'mismatched-sha256'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[ARTIFACT_HASH_MISMATCH\]/u);
});

test('rejects an existing artifact reference with no SHA-256', () => {
  const result = runPacket(path.join('negative', 'missing-sha256'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[ARTIFACT_HASH_MISSING\]/u);
});

test('rejects a packet recorded against a stale repository HEAD', () => {
  const result = runPacket(
    path.join('negative', 'stale-repository-head'),
    ['--repo', `nimi=${repoRoot}`],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[REPOSITORY_HEAD_MISMATCH\]/u);
});

test('rejects a missing clean execution preflight', () => {
  const result = runPacket(
    path.join('negative', 'missing-clean-preflight'),
    ['--repo', `nimi=${repoRoot}`],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[CLEAN_PREFLIGHT_MISSING\]/u);
});

test('rejects app-asserted caller and direct shell launch posture', () => {
  const result = runPacket(path.join('negative', 'wrong-caller-shell-launch'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[INVALID_LIVE_SHELL_POSTURE\]/u);
});

test('rejects a required live shell row that was not executed', () => {
  const result = runPacket(path.join('negative', 'required-shell-not-executed'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[REQUIRED_SHELL_ROW_NOT_EXECUTED\]/u);
});

test('rejects required live evidence without DOM, accessibility, and screenshot metadata', () => {
  const result = runPacket(path.join('negative', 'missing-live-ui-metadata'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[LIVE_UI_METADATA_MISSING\]/u);
});

test('rejects an unexplained console or page error', () => {
  const result = runPacket(path.join('negative', 'unexplained-console-error'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[UNEXPLAINED_RUNTIME_ERROR\]/u);
});

test('rejects a derived report without raw source artifacts', () => {
  const result = runPacket(path.join('negative', 'derived-report-without-sources'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[DERIVED_REPORT_SOURCE_MISSING\]/u);
});

test('rejects a packet schema-version mismatch', () => {
  const result = runPacket(path.join('negative', 'schema-version-mismatch'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[SCHEMA_VERSION_MISMATCH\]/u);
});

test('rejects an unknown packet field instead of trusting passed booleans', () => {
  const result = runPacket(path.join('negative', 'unknown-field'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[UNKNOWN_FIELD\]/u);
});

test('rejects an unknown field in a referenced packet artifact', () => {
  const result = runPacket(path.join('negative', 'unknown-nested-field'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[UNKNOWN_FIELD\]/u);
});

test('rejects an unknown acceptance row', () => {
  const result = runPacket(path.join('negative', 'unknown-required-row'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[UNKNOWN_REQUIRED_ROW\]/u);
});

test('rejects credential material anywhere in packet text', () => {
  const fixture = materializeValidPacket();
  try {
    const material = [
      'Author',
      'ization: Bearer ',
      'fixture-',
      'canary-',
      'credential',
    ].join('');
    fs.writeFileSync(path.join(fixture.packetRoot, 'credential-probe.txt'), material);
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[PROHIBITED_PACKET_MATERIAL\]/u);
    assert.equal(result.stderr.includes(material), false);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects synthetic private-path and raw-content canaries without echoing them', () => {
  for (const [fileName, material] of [
    ['private-path-probe.txt', ['C:', 'Users', 'fixture', 'private.txt'].join('\\')],
    ['raw-content-probe.json', JSON.stringify({ content: 'synthetic-media-canary' })],
  ]) {
    const fixture = materializeValidPacket();
    try {
      fs.writeFileSync(path.join(fixture.packetRoot, fileName), material);
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /\[PROHIBITED_PACKET_MATERIAL\]/u);
      assert.doesNotMatch(result.stderr, /synthetic-media-canary|private\.txt/u);
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('scans PNG, PDF, and media bytes and emits only a stable private rejection', () => {
  const cases = [
    { extension: 'png', encode: (value) => Buffer.from(value, 'utf8') },
    { extension: 'pdf', encode: (value) => Buffer.from(value, 'utf16le') },
    {
      extension: 'mp4',
      encode(value) {
        const littleEndian = Buffer.from(value, 'utf16le');
        return Buffer.from(littleEndian).swap16();
      },
    },
  ];
  for (const { extension, encode } of cases) {
    const fixture = materializeValidPacket();
    try {
      const secretName = `secret-customer-surface.${extension}`;
      const secretValue = 'nimi-synthetic-binary-canary-v1';
      fs.writeFileSync(
        path.join(fixture.packetRoot, secretName),
        Buffer.concat([Buffer.from([0, 255, 1, 254]), encode(secretValue)]),
      );
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );

      assert.equal(result.status, 1);
      assert.equal(result.stderr, '[PROHIBITED_PACKET_MATERIAL] validation rejected\n');
      assert.doesNotMatch(result.stderr, /secret-customer|synthetic-|canary|surface/iu);
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('detects an odd-aligned UTF-16LE credential in a recognized text artifact', () => {
  const fixture = materializeValidPacket();
  try {
    const material = 'Authorization: Bearer odd-aligned-credential';
    fs.writeFileSync(
      path.join(fixture.packetRoot, 'odd-aligned.txt'),
      Buffer.concat([Buffer.from([0xff]), Buffer.from(material, 'utf16le')]),
    );
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '[PROHIBITED_PACKET_MATERIAL] validation rejected\n');
    assert.doesNotMatch(result.stderr, /odd-aligned|credential|Authorization/iu);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('accepts a valid high-entropy PNG whose opaque chunk resembles text', () => {
  const fixture = materializeValidPacket();
  try {
    fs.writeFileSync(
      path.join(fixture.packetRoot, 'opaque-high-entropy.png'),
      makePngWithOpaqueAncillaryData(),
    );
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).disposition, 'implementation_incomplete');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('recognizes PNG iTXt metadata by signature and scans every textual field', () => {
  for (const fileName of ['international-text.png', 'international-text.bin']) {
    const fixture = materializeValidPacket();
    try {
      fs.writeFileSync(
        path.join(fixture.packetRoot, fileName),
        makePngWithInternationalTextKeyword('Authorization: Bearer png-metadata-credential'),
      );
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );

      assert.equal(result.status, 1);
      assert.equal(result.stderr, '[PROHIBITED_PACKET_MATERIAL] validation rejected\n');
      assert.doesNotMatch(result.stderr, /metadata|credential|Authorization/iu);
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('rejects Wave A evidence that enables Persona direct media', () => {
  const result = runPacket(path.join('negative', 'wave-a-persona-direct-media'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[WAVE_A_PERSONA_DIRECT_MEDIA_ENABLED\]/u);
});

test('rejects Wave R permanent-primary polling without observed upstream', () => {
  const result = runPacket(path.join('negative', 'wave-r-invalid-upstream-posture'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[WAVE_R_REALTIME_POSTURE_INVALID\]/u);
});

test('rejects unresolved Wave B finalize, cleanup, or signed-upload custody', () => {
  const result = runPacket(path.join('negative', 'wave-b-unresolved-media-posture'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[WAVE_B_MEDIA_POSTURE_UNRESOLVED\]/u);
});

test('rejects command exit and test counts that disagree with the raw log', () => {
  const fixtureResult = runPacket(path.join('negative', 'command-log-count-mismatch'));
  assert.equal(fixtureResult.status, 1);
  assert.match(fixtureResult.stderr, /\[COMMAND_LOG_MISMATCH\]/u);

  const fixture = materializeValidPacket();
  try {
    const commandsPath = path.join(fixture.packetRoot, 'commands.jsonl');
    const command = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
    command.tests.passed = 2;
    fs.writeFileSync(commandsPath, `${JSON.stringify(command)}\n`);
    refreshManifestRefs(fixture.packetRoot, { commands_ref: 'commands.jsonl' });
    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[COMMAND_LOG_MISMATCH\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects a command-row claim without a command record', () => {
  const fixture = materializeValidPacket();
  try {
    fs.writeFileSync(path.join(fixture.packetRoot, 'commands.jsonl'), '');
    refreshManifestRefs(fixture.packetRoot, { commands_ref: 'commands.jsonl' });

    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[COMMAND_EVIDENCE_MISSING\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects failing native TAP even when a custom footer claims success', () => {
  const fixture = materializeValidPacket();
  try {
    const logPath = path.join(fixture.packetRoot, 'command.tap');
    fs.writeFileSync(logPath, [
      'TAP version 13',
      'not ok 1 - fixture',
      '1..1',
      '# tests 1',
      '# suites 0',
      '# pass 0',
      '# fail 1',
      '# cancelled 0',
      '# skipped 0',
      '# todo 0',
      '# duration_ms 1',
      'evidence-command-result: exit_code=0 passed=1 failed=0 skipped=0',
      '',
    ].join('\n'));
    const logSha = sha256(logPath);
    const commandsPath = path.join(fixture.packetRoot, 'commands.jsonl');
    const command = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
    command.log_ref.sha256 = logSha;
    fs.writeFileSync(commandsPath, `${JSON.stringify(command)}\n`);
    const coveragePath = path.join(fixture.packetRoot, 'coverage.jsonl');
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    coverage.raw_artifact_refs[0].sha256 = logSha;
    fs.writeFileSync(coveragePath, `${JSON.stringify(coverage)}\n`);
    refreshManifestRefs(fixture.packetRoot, {
      commands_ref: 'commands.jsonl',
      coverage_ref: 'coverage.jsonl',
    });

    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[COMMAND_LOG_MISMATCH\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects command records outside their trusted preflight timeline or repository cwd', () => {
  const cases = [
    {
      mutate(packetRoot) {
        const baselinePath = path.join(packetRoot, 'execution-baseline.json');
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        baseline.repositories[0].observed_at = '2026-07-10T00:00:00.500Z';
        fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
        refreshManifestRefs(packetRoot, { baseline_ref: 'execution-baseline.json' });
      },
      code: 'COMMAND_TIMELINE_INVALID',
    },
    {
      mutate(packetRoot) {
        const commandsPath = path.join(packetRoot, 'commands.jsonl');
        const command = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
        command.ended_at = '2026-07-09T23:59:59.000Z';
        fs.writeFileSync(commandsPath, `${JSON.stringify(command)}\n`);
        refreshManifestRefs(packetRoot, { commands_ref: 'commands.jsonl' });
      },
      code: 'COMMAND_TIMELINE_INVALID',
    },
    {
      mutate(packetRoot) {
        const commandsPath = path.join(packetRoot, 'commands.jsonl');
        const command = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
        command.cwd = '../outside';
        fs.writeFileSync(commandsPath, `${JSON.stringify(command)}\n`);
        refreshManifestRefs(packetRoot, { commands_ref: 'commands.jsonl' });
      },
      code: 'COMMAND_CWD_INVALID',
    },
  ];
  for (const entry of cases) {
    const fixture = materializeValidPacket();
    try {
      entry.mutate(fixture.packetRoot);
      const result = runPacketPath(
        fixture.packetRoot,
        ['--repo', `nimi=${fixture.trustedRepo}`],
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^\\[${entry.code}\\]`, 'u'));
    } finally {
      fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
    }
  }
});

test('rejects a repository-relative command cwd that resolves through a junction outside', () => {
  const fixture = materializeValidPacket();
  try {
    const outsideCwd = path.join(fixture.tempRoot, 'outside-command-cwd');
    fs.mkdirSync(outsideCwd);
    fs.appendFileSync(
      path.join(fixture.trustedRepo, '.git', 'info', 'exclude'),
      '\noutside-cwd\n',
    );
    fs.symlinkSync(outsideCwd, path.join(fixture.trustedRepo, 'outside-cwd'), 'junction');
    const commandsPath = path.join(fixture.packetRoot, 'commands.jsonl');
    const command = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
    command.cwd = 'outside-cwd';
    fs.writeFileSync(commandsPath, `${JSON.stringify(command)}\n`);
    refreshManifestRefs(fixture.packetRoot, { commands_ref: 'commands.jsonl' });

    const result = runPacketPath(
      fixture.packetRoot,
      ['--repo', `nimi=${fixture.trustedRepo}`],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[COMMAND_CWD_INVALID\]/u);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects a structured synthetic-canary leak finding', () => {
  const result = runPacket(path.join('negative', 'structured-leak-finding'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[LEAK_FINDING_PRESENT\]/u);
});
