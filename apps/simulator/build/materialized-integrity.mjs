import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

import {
  assertSimulatorSourcePath,
  computeSourceDigestV1,
  sha256Digest,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';

const ACCEPTED_MODES = new Set(['100644', '100755']);

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function canonicalPath(value) {
  return value.split(path.sep).join('/');
}

function stripQuery(id) {
  return id.split('?', 1)[0];
}

function filesystemMode(stat) {
  return (stat.mode & 0o111) === 0 ? '100644' : '100755';
}

function readTree(rootDir) {
  const rows = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertSimulatorSourcePath(relative, relative);
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        fail('SIM_MATERIALIZED_SYMLINK', 'materialized source cannot contain symbolic links', relative);
      }
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) {
        fail('SIM_MATERIALIZED_FILE_KIND', 'materialized source contains an unsupported filesystem entry', relative);
      }
      const bytes = readFileSync(absolute);
      rows.push({
        path: relative,
        mode: filesystemMode(stat),
        bytes,
        digest: sha256Digest(bytes),
      });
    }
  };
  visit(rootDir, '');
  return rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function assertEvidenceFile(row, fieldPath) {
  if (!row || typeof row !== 'object') fail('SIM_MATERIALIZED_EVIDENCE', 'materialized file evidence must be an object', fieldPath);
  assertSimulatorSourcePath(row.path, `${fieldPath}.path`);
  if (!ACCEPTED_MODES.has(row.mode)) fail('SIM_MATERIALIZED_EVIDENCE', 'materialized file evidence has an invalid mode', `${fieldPath}.mode`);
  if (!Number.isSafeInteger(row.bytes) || row.bytes < 0) fail('SIM_MATERIALIZED_EVIDENCE', 'materialized file evidence has invalid byte length', `${fieldPath}.bytes`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.digest)) fail('SIM_MATERIALIZED_EVIDENCE', 'materialized file evidence has invalid digest', `${fieldPath}.digest`);
}

function assertExactInventory(location, actual) {
  const expected = location.files;
  if (!Array.isArray(expected) || expected.length !== location.fileCount) {
    fail('SIM_MATERIALIZED_EVIDENCE', 'materialization evidence file inventory is absent or incomplete', location.root);
  }
  if (actual.length !== expected.length) {
    fail('SIM_MATERIALIZED_INVENTORY_DRIFT', 'materialized source file count changed after qualification', location.root);
  }
  for (const [index, expectedFile] of expected.entries()) {
    assertEvidenceFile(expectedFile, `${location.root}files[${index}]`);
    const actualFile = actual[index];
    if (
      !actualFile
      || actualFile.path !== expectedFile.path
      || actualFile.mode !== expectedFile.mode
      || actualFile.bytes.length !== expectedFile.bytes
      || actualFile.digest !== expectedFile.digest
    ) {
      fail('SIM_MATERIALIZED_FILE_DRIFT', 'materialized source bytes, mode, or path changed after qualification', expectedFile.path);
    }
  }
  const sourceDigest = computeSourceDigestV1(actual.map((row) => ({
    path: row.path,
    mode: row.mode,
    bytes: row.bytes,
  })));
  if (sourceDigest !== location.sourceDigest) {
    fail('SIM_MATERIALIZED_SOURCE_DIGEST_DRIFT', 'materialized source digest differs from qualification evidence', location.root);
  }
}

export function createMaterializedIntegrityVerifier({ generatedRoot }) {
  const materializedRoot = path.resolve(generatedRoot, 'materialized');
  const evidencePath = path.resolve(generatedRoot, 'evidence', 'materialization.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  if (!Array.isArray(evidence)) fail('SIM_MATERIALIZED_EVIDENCE', 'materialization evidence must be an array');
  const locations = [];
  const filesByAbsolutePath = new Map();
  for (const [moduleIndex, moduleRow] of evidence.entries()) {
    if (!moduleRow || typeof moduleRow.moduleId !== 'string' || !Array.isArray(moduleRow.sourceLocations)) {
      fail('SIM_MATERIALIZED_EVIDENCE', 'materialization module evidence is invalid', `modules[${moduleIndex}]`);
    }
    for (const [sourceIndex, location] of moduleRow.sourceLocations.entries()) {
      const expectedRoot = `source/${moduleRow.moduleId}/${location?.sourceId}/`;
      if (!location || location.root !== expectedRoot) {
        fail('SIM_MATERIALIZED_EVIDENCE', 'materialization source root is not canonical', `modules[${moduleIndex}].sourceLocations[${sourceIndex}].root`);
      }
      const absoluteRoot = path.resolve(materializedRoot, ...location.root.split('/').filter(Boolean));
      if (!absoluteRoot.startsWith(`${materializedRoot}${path.sep}`)) {
        fail('SIM_MATERIALIZED_EVIDENCE', 'materialization evidence root escapes generated staging', location.root);
      }
      const row = { location, absoluteRoot };
      locations.push(row);
      for (const [fileIndex, file] of (location.files || []).entries()) {
        assertEvidenceFile(file, `${location.root}files[${fileIndex}]`);
        const absolute = path.join(absoluteRoot, ...file.path.split('/'));
        if (filesByAbsolutePath.has(absolute)) {
          fail('SIM_MATERIALIZED_EVIDENCE', 'materialization evidence contains a duplicate file path', file.path);
        }
        filesByAbsolutePath.set(absolute, file);
      }
    }
  }

  const verifyAll = () => {
    for (const row of locations) assertExactInventory(row.location, readTree(row.absoluteRoot));
  };

  const verifyTransform = (code, id) => {
    const absolute = path.resolve(stripQuery(id));
    if (absolute !== materializedRoot && !absolute.startsWith(`${materializedRoot}${path.sep}`)) return false;
    const expected = filesByAbsolutePath.get(absolute);
    if (!expected) fail('SIM_MATERIALIZED_UNQUALIFIED_FILE', 'build requested a materialized file absent from qualification evidence', canonicalPath(path.relative(materializedRoot, absolute)));
    const stat = lstatSync(absolute);
    if (!stat.isFile() || filesystemMode(stat) !== expected.mode) {
      fail('SIM_MATERIALIZED_FILE_DRIFT', 'materialized source file kind or mode changed during build', expected.path);
    }
    const diskBytes = readFileSync(absolute);
    const transformBytes = Buffer.from(code, 'utf8');
    if (
      diskBytes.length !== expected.bytes
      || sha256Digest(diskBytes) !== expected.digest
      || transformBytes.length !== expected.bytes
      || sha256Digest(transformBytes) !== expected.digest
    ) {
      fail('SIM_MATERIALIZED_TRANSFORM_DRIFT', 'build transform input differs from qualified materialized bytes', expected.path);
    }
    return true;
  };

  return Object.freeze({ verifyAll, verifyTransform });
}
