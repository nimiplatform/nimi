import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { readYamlWithFragments } from '../shared/read-yaml-with-fragments.mjs';

const DEFAULT_DOC_ROOTS = ['.local'];
const HIGH_RISK_NAME_PATTERNS = [
  /design/iu,
  /audit/iu,
  /implementation-plan/iu,
  /architecture/iu,
  /refactor/iu,
  /refactory/iu,
  /remediation-plan/iu,
  /unification/iu,
  /migration/iu,
];
const REQUIRED_METADATA_KEYS = [
  'Spec Status',
  'Authority Owner',
  'Work Type',
  'Parallel Truth',
];

function normalizeRel(filePath, repoRoot) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function isMarkdownFile(filePath) {
  return filePath.endsWith('.md');
}

function shouldSkip(relPath) {
  return relPath.includes('/archive/');
}

function isHighRiskByName(relPath, patterns = HIGH_RISK_NAME_PATTERNS) {
  const base = path.basename(relPath);
  return patterns.some((pattern) => pattern.test(base));
}

function readFileSafe(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function detectMetadata(content, requiredMetadataKeys = REQUIRED_METADATA_KEYS) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (frontmatterMatch) {
    const doc = YAML.parse(frontmatterMatch[1]) || {};
    const values = new Map([
      ['Spec Status', String(doc?.spec_status || '').trim()],
      ['Authority Owner', String(doc?.authority_owner || '').trim()],
      ['Work Type', String(doc?.work_type || '').trim()],
      ['Parallel Truth', String(doc?.parallel_truth || '').trim()],
    ]);
    for (const key of requiredMetadataKeys) {
      if (!values.has(key)) {
        values.set(key, '');
      }
    }
    return values;
  }
  const lines = content.split(/\r?\n/u).slice(0, 20);
  const found = new Map();
  for (const key of requiredMetadataKeys) {
    const prefix = `> **${key}**:`;
    const line = lines.find((item) => item.startsWith(prefix)) || null;
    found.set(key, line ? line.slice(prefix.length).trim() : '');
  }
  return found;
}

function validateMetadata(meta, requiredMetadataKeys = REQUIRED_METADATA_KEYS) {
  const failures = [];
  for (const key of requiredMetadataKeys) {
    const value = meta.get(key) || '';
    if (!value) {
      failures.push(`missing metadata field "${key}"`);
    }
  }
  const workType = meta.get('Work Type') || '';
  if (workType && workType !== 'alignment' && workType !== 'redesign') {
    failures.push('Work Type must be "alignment" or "redesign"');
  }
  const parallelTruth = meta.get('Parallel Truth') || '';
  if (parallelTruth && parallelTruth !== 'yes' && parallelTruth !== 'no') {
    failures.push('Parallel Truth must be "yes" or "no"');
  }
  const specStatus = meta.get('Spec Status') || '';
  const validSpecStatuses = new Set([
    'aligned',
    'requires spec change',
    'requires_change',
    'preflight-required',
  ]);
  if (specStatus && !validSpecStatuses.has(specStatus)) {
    failures.push('Spec Status must be one of: aligned, requires spec change, requires_change, preflight-required');
  }
  return failures;
}

function walkMarkdownFiles(dirPath) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(nextPath));
      continue;
    }
    if (entry.isFile() && isMarkdownFile(nextPath)) {
      results.push(nextPath);
    }
  }
  return results;
}

export function evaluateHighRiskDocMetadata(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const docRoots = Array.isArray(options.docRoots) && options.docRoots.length > 0
    ? options.docRoots
    : DEFAULT_DOC_ROOTS;
  const requiredMetadataKeys = Array.isArray(options.requiredMetadataKeys) && options.requiredMetadataKeys.length > 0
    ? options.requiredMetadataKeys.map((value) => String(value || '').trim()).filter(Boolean)
    : REQUIRED_METADATA_KEYS;
  const namePatterns = Array.isArray(options.namePatterns) && options.namePatterns.length > 0
    ? options.namePatterns.map((value) => new RegExp(String(value), 'iu'))
    : HIGH_RISK_NAME_PATTERNS;
  const exemptionsPath = options.exemptionsPath
    || path.join(repoRoot, 'scripts/config/high-risk-doc-metadata-exemptions.yaml');
  const exemptionsDoc = options.exemptPaths
    ? { exempt_paths: options.exemptPaths }
    : fs.existsSync(exemptionsPath)
      ? (readYamlWithFragments(exemptionsPath) || {})
      : {};
  const exemptPaths = new Set(
    (Array.isArray(exemptionsDoc?.exempt_paths) ? exemptionsDoc.exempt_paths : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  const scanned = [];
  const failures = [];

  for (const rootRel of docRoots) {
    const absRoot = path.join(repoRoot, rootRel);
    if (!fs.existsSync(absRoot)) {
      continue;
    }
    for (const filePath of walkMarkdownFiles(absRoot)) {
      const relPath = normalizeRel(filePath, repoRoot);
      if (shouldSkip(relPath) || !isHighRiskByName(relPath, namePatterns)) {
        continue;
      }
      scanned.push(relPath);
      if (exemptPaths.has(relPath)) {
        continue;
      }
      const content = readFileSafe(filePath);
      const meta = detectMetadata(content, requiredMetadataKeys);
      const fileFailures = validateMetadata(meta, requiredMetadataKeys);
      for (const failure of fileFailures) {
        failures.push(`${relPath}: ${failure}`);
      }
    }
  }

  return {
    scanned,
    failures,
    exemptPaths,
  };
}
