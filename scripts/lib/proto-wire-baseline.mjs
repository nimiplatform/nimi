import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawnSyncCommand } from './command-runner.mjs';

// The breaking-change gate protects the Runtime wire that is already published,
// not a snapshot of whatever source was current when it was last refreshed.
// The record names the component tag whose published artifacts carry that
// wire, and the committed image must rebuild byte-for-byte from that tag.

export const BASELINE_RECORD_PATH = 'runtime/proto/runtime-v1.baseline.json';
export const BASELINE_IMAGE_PATH = 'runtime/proto/runtime-v1.baseline.binpb';
export const BASELINE_RECORD_SCHEMA = 'nimi.proto-wire-baseline/v1';
export const BASELINE_IMAGE_FORMAT = 'file-descriptor-set-without-source-info';

// Buf images carry release-specific metadata; a descriptor set without source
// info is identical across Buf releases, so provenance can compare bytes.
const IMAGE_BUILD_FLAGS = ['--as-file-descriptor-set', '--exclude-source-info'];
// Families whose published artifacts carry the Runtime wire: SDK generated
// protobuf, Kit native carriers and the Rust shell crates packaging the proto.
export const WIRE_SOURCE_TAG = /^(?:sdk|kit|nimi-shell-protected-local|nimi-shell-tauri)\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
export const PUBLISHED_ARTIFACT = /^(?:npm|crates):(?:@[a-z0-9-]+\/)?[a-z0-9-]+@(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const MIGRATION_FILE = /^(?:[A-Za-z0-9._-]+\/)*CHANGELOG\.md$/u;
const FINDING_KEYS = ['rule', 'path', 'message'];

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join('\n') !== expected.join('\n')) {
    fail(`${label} must contain exactly ${expected.join(', ')}; found ${actual.join(', ') || 'nothing'}`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(`${label} must be non-empty trimmed text`);
  return value;
}

function matching(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is invalid: ${JSON.stringify(value)}`);
  return value;
}

function validateFindingFields(value, extraKeys, label) {
  exactKeys(value, [...FINDING_KEYS, ...extraKeys], label);
  for (const key of FINDING_KEYS) text(value[key], `${label}.${key}`);
}

export function validateMigration(value, label) {
  exactKeys(value, ['file', 'heading'], label);
  matching(value.file, MIGRATION_FILE, `${label}.file`);
  text(value.heading, `${label}.heading`);
}

export function findingKey(finding) {
  return JSON.stringify([finding.rule, finding.path, finding.message]);
}

// Structural validation only; provenance and migration notes are checked
// against the repository separately.
export function validateBaselineRecord(record) {
  exactKeys(record, ['schema', 'image', 'source', 'refresh', 'declaredBreaking'], 'baseline record');
  if (record.schema !== BASELINE_RECORD_SCHEMA) fail(`baseline record schema must be ${BASELINE_RECORD_SCHEMA}`);

  exactKeys(record.image, ['path', 'format', 'sha256'], 'image');
  if (record.image.path !== BASELINE_IMAGE_PATH) fail(`image.path must be ${BASELINE_IMAGE_PATH}`);
  if (record.image.format !== BASELINE_IMAGE_FORMAT) fail(`image.format must be ${BASELINE_IMAGE_FORMAT}`);
  matching(record.image.sha256, SHA256, 'image.sha256');

  exactKeys(record.source, ['tag', 'commit', 'publishedArtifacts'], 'source');
  matching(record.source.tag, WIRE_SOURCE_TAG, 'source.tag');
  matching(record.source.commit, COMMIT, 'source.commit');
  if (!Array.isArray(record.source.publishedArtifacts) || record.source.publishedArtifacts.length === 0) {
    fail('source.publishedArtifacts must name the published artifacts that carry this wire');
  }
  record.source.publishedArtifacts.forEach((item, index) => matching(item, PUBLISHED_ARTIFACT, `source.publishedArtifacts[${index}]`));

  exactKeys(record.refresh, ['previous', 'breakingFromPrevious', 'adjudication'], 'refresh');
  exactKeys(record.refresh.previous, ['source', 'imageSha256'], 'refresh.previous');
  text(record.refresh.previous.source, 'refresh.previous.source');
  matching(record.refresh.previous.imageSha256, SHA256, 'refresh.previous.imageSha256');
  if (!Array.isArray(record.refresh.breakingFromPrevious)) fail('refresh.breakingFromPrevious must be a list');
  record.refresh.breakingFromPrevious.forEach((item, index) => {
    const label = `refresh.breakingFromPrevious[${index}]`;
    validateFindingFields(item, ['migration'], label);
    if (item.migration !== null) validateMigration(item.migration, `${label}.migration`);
  });
  text(record.refresh.adjudication, 'refresh.adjudication');

  if (!Array.isArray(record.declaredBreaking)) fail('declaredBreaking must be a list');
  const seen = new Set();
  record.declaredBreaking.forEach((item, index) => {
    const label = `declaredBreaking[${index}]`;
    validateFindingFields(item, ['reason', 'migration'], label);
    text(item.reason, `${label}.reason`);
    validateMigration(item.migration, `${label}.migration`);
    if (seen.has(findingKey(item))) fail(`${label} duplicates an earlier declaration`);
    seen.add(findingKey(item));
  });
  return record;
}

export function readBaselineRecord(repoRoot) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, BASELINE_RECORD_PATH), 'utf8'));
  } catch (error) {
    fail(`cannot read ${BASELINE_RECORD_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateBaselineRecord(parsed);
}

export function writeBaselineRecord(repoRoot, record) {
  validateBaselineRecord(record);
  fs.writeFileSync(path.join(repoRoot, BASELINE_RECORD_PATH), `${JSON.stringify(record, null, 2)}\n`);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// A declared or published break is admissible only with a migration note that
// its consumers can read in the package's changelog.
export function verifyMigrationReferences(repoRoot, migrations) {
  for (const { file, heading } of migrations) {
    let source;
    try {
      source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      fail(`migration note file ${file} does not exist`);
    }
    const headings = source.split(/\r?\n/u).map((line) => /^#{2,4} (.+)$/u.exec(line)?.[1]?.trim()).filter(Boolean);
    if (!headings.includes(heading)) fail(`migration note heading "${heading}" is missing from ${file}`);
  }
}

export function recordMigrations(record) {
  return [
    ...record.declaredBreaking.map((item) => item.migration),
    ...record.refresh.breakingFromPrevious.map((item) => item.migration).filter(Boolean),
  ];
}

function run(command, args, options = {}) {
  const result = spawnSyncCommand(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    error: result.error || null,
    status: result.error ? null : result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function describeFailure(result) {
  return result.error?.message || result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
}

function git(repoRoot, args) {
  const result = run('git', args, { cwd: repoRoot });
  if (result.error || result.status !== 0) fail(`git ${args.join(' ')} failed: ${describeFailure(result)}`);
  return result.stdout.trim();
}

function probeBuf(command, env) {
  const probe = run(command, ['--version'], { env });
  return !probe.error && probe.status === 0 ? { command, version: probe.stdout.trim() } : null;
}

// PATH first, then the Go-installed binary that CI provisions.
export function resolveBuf({ env = process.env } = {}) {
  const onPath = probeBuf('buf', env);
  if (onPath) return onPath;
  const gopath = run('go', ['env', 'GOPATH'], { env });
  if (gopath.error || gopath.status !== 0 || !gopath.stdout.trim()) return null;
  return probeBuf(path.join(gopath.stdout.trim(), 'bin', process.platform === 'win32' ? 'buf.exe' : 'buf'), env);
}

export function requireBuf(buf) {
  if (!buf) fail('buf is not installed; install it with `go install github.com/bufbuild/buf/cmd/buf@v1.70.0`');
  return buf;
}

export function buildWireImage({ buf, protoDir, outputPath }) {
  const result = run(requireBuf(buf).command, ['build', '.', ...IMAGE_BUILD_FLAGS, '-o', outputPath], { cwd: protoDir });
  if (result.error || result.status !== 0) fail(`buf build failed in ${protoDir}: ${describeFailure(result)}`);
  return fs.readFileSync(outputPath);
}

export function formatFinding(finding) {
  return `  ${finding.path}${finding.line ? `:${finding.line}` : ''}: ${finding.message} (${finding.rule})`;
}

// Findings are Buf's exact annotations. COMPILE annotations are not wire
// differences; unreadable input fails the gate instead of being classified.
export function breakingFindings({ buf, protoDir, againstImage }) {
  const result = run(requireBuf(buf).command, ['breaking', '.', '--against', againstImage, '--error-format', 'json'], { cwd: protoDir });
  if (result.error) fail(`buf breaking could not start: ${result.error.message}`);
  if (result.status === 0) return [];
  if (result.status !== 100) fail(`buf breaking failed (exit ${result.status}): ${describeFailure(result)}`);
  const findings = result.stdout.split(/\r?\n/u).filter((line) => line.trim()).map((line) => {
    let annotation;
    try {
      annotation = JSON.parse(line);
    } catch {
      fail(`buf breaking returned unreadable output: ${line}`);
    }
    return {
      rule: text(annotation.type, 'buf finding type'),
      path: text(annotation.path, 'buf finding path'),
      message: text(annotation.message, 'buf finding message'),
      line: Number(annotation.start_line) || 0,
    };
  });
  if (findings.length === 0) fail(`buf breaking exited 100 without findings: ${describeFailure(result)}`);
  const compile = findings.filter((finding) => finding.rule === 'COMPILE');
  if (compile.length > 0) fail(`proto source does not compile:\n${compile.map(formatFinding).join('\n')}`);
  return findings;
}

// Every finding must be declared, and every declaration must still describe a
// current finding: a stale declaration would pre-approve a future break.
export function classifyFindings(findings, declarations) {
  const declared = new Set(declarations.map(findingKey));
  const found = new Set(findings.map(findingKey));
  return {
    declared: findings.filter((finding) => declared.has(findingKey(finding))),
    undeclared: findings.filter((finding) => !declared.has(findingKey(finding))),
    stale: declarations.filter((item) => !found.has(findingKey(item))),
  };
}

export function withTempDir(prefix, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function extractProtoAtCommit(repoRoot, commit, targetDir) {
  const archive = path.join(targetDir, 'proto.tar');
  git(repoRoot, ['archive', '--format=tar', `--output=${archive}`, commit, 'proto']);
  const result = run('tar', ['-xf', archive, '-C', targetDir]);
  if (result.error || result.status !== 0) fail(`cannot extract proto from ${commit}: ${describeFailure(result)}`);
  fs.rmSync(archive);
  return path.join(targetDir, 'proto');
}

export function buildWireImageFromCommit({ repoRoot, buf, commit }) {
  return withTempDir('nimi-proto-wire-', (dir) => buildWireImage({
    buf,
    protoDir: extractProtoAtCommit(repoRoot, commit, dir),
    outputPath: path.join(dir, 'wire.binpb'),
  }));
}

export function isAncestor(repoRoot, commit, ref) {
  const result = run('git', ['merge-base', '--is-ancestor', commit, ref], { cwd: repoRoot });
  if (!result.error && (result.status === 0 || result.status === 1)) return result.status === 0;
  return fail(`cannot compare ${commit} with ${ref}: ${describeFailure(result)}`);
}

export function resolveTagCommit(repoRoot, tag) {
  const result = run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { cwd: repoRoot });
  const commit = result.stdout.trim();
  if (result.error || result.status !== 0 || !COMMIT.test(commit)) {
    fail(`published wire source tag ${tag} is not available locally; fetch it with `
      + `git fetch --no-tags --depth=1 origin +refs/tags/${tag}:refs/tags/${tag}`);
  }
  return commit;
}

// The committed image must be exactly the wire of the recorded published tag.
export function verifyBaselineProvenance({ repoRoot, record, buf, imagePath = path.join(repoRoot, record.image.path) }) {
  const imageBytes = fs.readFileSync(imagePath);
  if (sha256(imageBytes) !== record.image.sha256) {
    fail(`${record.image.path} does not match the sha256 recorded in ${BASELINE_RECORD_PATH}; `
      + 'change the baseline only through pnpm proto:baseline:refresh');
  }
  const tagCommit = resolveTagCommit(repoRoot, record.source.tag);
  if (tagCommit !== record.source.commit) {
    fail(`${record.source.tag} resolves to ${tagCommit}, not the recorded published commit ${record.source.commit}`);
  }
  const rebuilt = buildWireImageFromCommit({ repoRoot, buf, commit: record.source.commit });
  if (!rebuilt.equals(imageBytes)) {
    fail(`${record.image.path} is not the wire published at ${record.source.tag}; rebuild it from that tag with pnpm proto:baseline:refresh`);
  }
  return imageBytes;
}
