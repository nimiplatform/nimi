#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH,
  extractDesktopOpenAcceptanceRows,
} from './lib/desktop-open-acceptance-rows.mjs';
import { failWith, pass, read, root } from './lib/desktop-open-checks.mjs';

const matrix = read(DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH);
const acceptanceRows = extractDesktopOpenAcceptanceRows(matrix);
const rowIds = acceptanceRows.map((row) => row.rowId);
const failures = [];
if (rowIds.length === 0) {
  failures.push('acceptance matrix exposes no row ids');
}

const manifestRelPath = '.nimi/local/evidence/desktop-open-intent/e2e-acceptance-manifest.json';
const manifestPath = path.join(root, manifestRelPath);
const allowedStatuses = new Set(['passed', 'pending-platform-e2e']);
const allowedAssertionKinds = new Set(['test-name', 'rust-test-name', 'test-data-row', 'guard-invariant']);

if (!existsSync(manifestPath)) {
  failures.push(`desktop open acceptance evidence manifest is missing: ${manifestRelPath}`);
} else {
  const manifest = JSON.parse(read(manifestRelPath));
  if (manifest.sourceMatrix !== DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH) {
    failures.push(`acceptance manifest sourceMatrix must be ${DESKTOP_OPEN_ACCEPTANCE_MATRIX_PATH}`);
  }

  const rows = Array.isArray(manifest.rows) ? manifest.rows : [];
  const expected = new Set(rowIds);
  const covered = new Map();

  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') {
      failures.push(`manifest row ${index} is not an object`);
      continue;
    }
    if (typeof row.rowId !== 'string' || !row.rowId.trim()) {
      failures.push(`manifest row ${index} has no rowId`);
      continue;
    }
    if (covered.has(row.rowId)) {
      failures.push(`acceptance manifest duplicates row id ${row.rowId}`);
    }
    covered.set(row.rowId, row);
    if (!expected.has(row.rowId)) {
      failures.push(`acceptance manifest has unknown row id ${row.rowId}`);
    }
    if (!allowedStatuses.has(row.status)) {
      failures.push(`acceptance manifest row ${row.rowId} has unsupported status ${JSON.stringify(row.status)}`);
    }
    if (typeof row.evidenceKind !== 'string' || !row.evidenceKind.trim()) {
      failures.push(`acceptance manifest row ${row.rowId} has no evidenceKind`);
    }
    const hasEvidenceRef = Array.isArray(row.evidenceRef)
      ? row.evidenceRef.length > 0 && row.evidenceRef.every((item) => typeof item === 'string' && item.trim())
      : typeof row.evidenceRef === 'string' && row.evidenceRef.trim();
    if (!hasEvidenceRef) {
      failures.push(`acceptance manifest row ${row.rowId} has no evidenceRef`);
    }
    const hasAssertionRef = Array.isArray(row.assertionRefs)
      && row.assertionRefs.length > 0
      && row.assertionRefs.every((item) =>
        item
        && typeof item === 'object'
        && typeof item.file === 'string'
        && item.file.trim()
        && typeof item.assertionKind === 'string'
        && allowedAssertionKinds.has(item.assertionKind)
        && typeof item.assertion === 'string'
        && item.assertion.trim()
      );
    if (row.status === 'passed' && !hasAssertionRef) {
      failures.push(`acceptance manifest row ${row.rowId} has no row-specific assertionRefs`);
    }
    if (row.status === 'passed' && hasAssertionRef) {
      for (const assertionRef of row.assertionRefs) {
        const assertionFile = path.join(root, assertionRef.file.split('#')[0]);
        if (!existsSync(assertionFile)) {
          failures.push(`acceptance manifest row ${row.rowId} assertion file is missing: ${assertionRef.file}`);
          continue;
        }
        const assertionSource = readFileSync(assertionFile, 'utf8');
        if (assertionRef.assertion.startsWith('desktop-open-acceptance:')) {
          failures.push(`acceptance manifest row ${row.rowId} must not use marker assertionRefs`);
          continue;
        }
        const assertionFailure = validateAssertionRef(row, assertionRef, assertionSource);
        if (assertionFailure) {
          failures.push(assertionFailure);
        }
      }
    }
  }

  for (const rowId of rowIds) {
    if (!covered.has(rowId)) {
      failures.push(`acceptance manifest missing row id ${rowId}`);
    }
  }

  const pendingRows = rows.filter((row) => row?.status === 'pending-platform-e2e');
  if (pendingRows.length > 0 && failures.length === 0) {
    console.warn(`desktop open acceptance manifest has ${pendingRows.length} platform e2e pending row(s):`);
    for (const row of pendingRows) {
      console.warn(`- ${row.rowId}`);
    }
  }
}

failWith('Desktop Open acceptance evidence manifest guard failed.', failures);
pass('desktop open acceptance evidence manifest guard passed');

function validateAssertionRef(row, assertionRef, assertionSource) {
  const assertion = assertionRef.assertion;
  if (assertionRef.assertionKind === 'test-name') {
    const escaped = escapeRegExp(assertion);
    const testPattern = new RegExp(`\\b(?:test|it)\\(\\s*['"\`]${escaped}['"\`]`, 'u');
    if (!testPattern.test(assertionSource)) {
      return `acceptance manifest row ${row.rowId} test name ${JSON.stringify(assertion)} is missing from ${assertionRef.file}`;
    }
    return null;
  }
  if (assertionRef.assertionKind === 'rust-test-name') {
    const escaped = escapeRegExp(assertion);
    const rustPattern = new RegExp(`\\bfn\\s+${escaped}\\s*\\(`, 'u');
    if (!rustPattern.test(assertionSource)) {
      return `acceptance manifest row ${row.rowId} rust test ${JSON.stringify(assertion)} is missing from ${assertionRef.file}`;
    }
    return null;
  }
  if (assertionRef.assertionKind === 'test-data-row') {
    const escaped = escapeRegExp(assertion);
    const rowPattern = new RegExp(`\\browId:\\s*['"]${escaped}['"]`, 'u');
    if (!rowPattern.test(assertionSource)) {
      return `acceptance manifest row ${row.rowId} test data row ${JSON.stringify(assertion)} is missing from ${assertionRef.file}`;
    }
    return null;
  }
  if (assertionRef.assertionKind === 'guard-invariant') {
    if (assertion !== row.rowId) {
      return `acceptance manifest row ${row.rowId} guard invariant must equal the row id, got ${JSON.stringify(assertion)}`;
    }
    const guardSource = stripLineComments(assertionSource);
    if (!/\bguardInvariants\b/u.test(guardSource)) {
      return `acceptance manifest row ${row.rowId} guard assertion file ${assertionRef.file} exposes no guardInvariants`;
    }
    const escaped = escapeRegExp(assertion);
    const invariantPattern = new RegExp(`['"\`]${escaped}['"\`]`, 'u');
    if (!invariantPattern.test(guardSource)) {
      return `acceptance manifest row ${row.rowId} guard invariant ${JSON.stringify(assertion)} is missing from ${assertionRef.file}`;
    }
    return null;
  }
  return `acceptance manifest row ${row.rowId} has unsupported assertionKind ${JSON.stringify(assertionRef.assertionKind)}`;
}

function stripLineComments(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
