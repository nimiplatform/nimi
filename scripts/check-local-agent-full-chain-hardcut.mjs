#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { fullScopeAppCodeFindings } from './lib/local-agent-full-chain-app-scan.mjs';
import { runtimeMaterializationCodeFindings } from './lib/local-agent-runtime-materialization-hardcut.mjs';
import { runtimeContextConsumerCodeFindings } from './lib/local-agent-runtime-context-hardcut.mjs';
import {
  consumerRequirements,
  conversationReportRequirements,
  expectedTraceabilityMappings,
  markdownOwner,
  ownerPaths,
  runtimeRequirements,
  scopeRoots,
  yamlOwner,
} from './lib/local-agent-full-chain-authority-model.mjs';
import { runAuthorityAdversarialSelfTests } from './lib/local-agent-full-chain-authority-self-tests.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const validScopes = new Set(['runtime-authority', 'consumer-authority', 'authority', 'runtime-materialization', 'runtime-consumer', 'all']);
const textExtensions = new Set(['.md', '.yaml', '.yml']);
const excludedDirectoryNames = new Set([
  '.git',
  '.local',
  'archive',
  'evidence',
  'gen',
  'generated',
  'historical',
  'history',
  'local',
  'node_modules',
  'plan',
  'plans',
]);

function usage() {
  return 'usage: pnpm check:local-agent-full-chain-hardcut -- --scope <runtime-authority|consumer-authority|authority|runtime-materialization|runtime-consumer|all>\n';
}

function parseScope(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length === 0) return 'runtime-materialization';
  if (args.length !== 2 || args[0] !== '--scope' || !validScopes.has(args[1])) {
    process.stderr.write(usage());
    process.exit(2);
  }
  return args[1];
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function isExcludedFile(relPath) {
  const basename = path.basename(relPath);
  return basename.startsWith('rule-evidence') || basename.includes('.generated.');
}

function normalizeStatement(value) {
  return String(value)
    .replace(/[`*_]/gu, '')
    .replace(/[—–]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.;]+$/u, '')
    .toLowerCase();
}

function splitSentenceChunk(text, line) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z`])/u)
    .map((statement) => ({ line, text: statement.trim(), normalized: normalizeStatement(statement) }))
    .filter((statement) => statement.normalized);
}

function extractMarkdownStatements(lines, startLine) {
  const statements = [];
  let chunk = [];
  let chunkLine = startLine;
  let inFence = false;

  function flush() {
    if (chunk.length === 0) return;
    statements.push(...splitSentenceChunk(chunk.join(' '), chunkLine));
    chunk = [];
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = startLine + index;
    if (/^\s*```/u.test(rawLine)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence || /^\s*\|/u.test(rawLine)) return;
    const bullet = rawLine.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/u);
    if (bullet) {
      flush();
      chunkLine = lineNumber;
      chunk.push(bullet[1]);
      return;
    }
    if (!rawLine.trim()) {
      flush();
      return;
    }
    if (chunk.length === 0) chunkLine = lineNumber;
    chunk.push(rawLine.trim());
  });
  flush();
  return statements;
}

function parseMarkdownRules(document) {
  const lines = document.text.split('\n');
  const rules = [];
  let current = null;

  function flush(endIndex) {
    if (!current) return;
    const bodyLines = lines.slice(current.bodyStartIndex, endIndex);
    rules.push({
      relPath: document.relPath,
      id: current.id,
      line: current.line,
      statements: extractMarkdownStatements(bodyLines, current.line + 1),
    });
  }

  lines.forEach((line, index) => {
    if (!line.startsWith('## ')) return;
    const match = line.match(/^##\s+([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+)\b/u);
    flush(index);
    current = match
      ? { id: match[1], line: index + 1, bodyStartIndex: index + 1 }
      : null;
  });
  flush(lines.length);
  return rules;
}

function yamlRecordIdentifier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const field of ['rule_id', 'key', 'id', 'machine_id', 'name', 'state']) {
    if (typeof value[field] === 'string' && value[field].trim()) {
      return { field, value: value[field].trim() };
    }
  }
  return null;
}

function flattenRecordScalarPairs(value, prefix = '', output = [], isRecordRoot = false) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (yamlRecordIdentifier(entry)) return;
      flattenRecordScalarPairs(entry, `${prefix}[${index}]`, output);
    });
    return output;
  }
  if (value && typeof value === 'object') {
    if (!isRecordRoot && yamlRecordIdentifier(value)) return output;
    for (const [key, entry] of Object.entries(value)) {
      flattenRecordScalarPairs(entry, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (value !== null && typeof value !== 'undefined') output.push(`${prefix}=${String(value)}`);
  return output;
}

function parseYamlRecords(document) {
  const parsed = YAML.parse(document.text);
  const records = [];

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const identifier = yamlRecordIdentifier(value);
    if (identifier) {
      const text = flattenRecordScalarPairs(value, '', [], true).join('; ');
      records.push({
        relPath: document.relPath,
        id: `${identifier.field}=${identifier.value}`,
        identifier,
        value,
        text,
        normalized: normalizeStatement(text),
      });
    }
    Object.values(value).forEach(visit);
  }

  visit(parsed);
  return { parsed, records };
}

async function collectAuthorityDocuments(relRoots) {
  const documents = [];

  async function walk(absDir) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.isDirectory() && (excludedDirectoryNames.has(entry.name) || entry.name.startsWith('rule-evidence'))) continue;
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
      const relPath = toRepoRelative(absPath);
      if (isExcludedFile(relPath)) continue;
      const text = await fs.readFile(absPath, 'utf8');
      const document = { relPath, text, kind: path.extname(entry.name) === '.md' ? 'markdown' : 'yaml' };
      if (document.kind === 'markdown') {
        document.rules = parseMarkdownRules(document);
      } else {
        const parsedYaml = parseYamlRecords(document);
        document.parsed = parsedYaml.parsed;
        document.records = parsedYaml.records;
      }
      documents.push(document);
    }
  }

  for (const relRoot of relRoots) await walk(path.join(repoRoot, ...relRoot.split('/')));
  documents.sort((left, right) => left.relPath.localeCompare(right.relPath, 'en'));
  return documents;
}

function findYamlRecord(documents, relPath, field, value) {
  const document = documents.find((entry) => entry.relPath === relPath && entry.kind === 'yaml');
  return document?.records.find((record) => (
    record.identifier.field === field && record.identifier.value === value
  )) ?? null;
}

function extractCompactRuleIds(value) {
  const ids = [];
  const pattern = /\b((?:K|P|S|D|Z|R)-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-)(\d{3}(?:\/\d{3})*)\b/gu;
  let match;
  while ((match = pattern.exec(String(value))) !== null) {
    for (const suffix of match[2].split('/')) ids.push(`${match[1]}${suffix}`);
  }
  return ids;
}

function parseTraceabilityRows(text) {
  const sectionStart = text.indexOf('## 4. Requirement');
  const sectionEnd = text.indexOf('\n## 5.', sectionStart);
  if (sectionStart < 0 || sectionEnd < 0) return new Map();
  const rows = new Map();
  for (const line of text.slice(sectionStart, sectionEnd).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3 || !expectedTraceabilityMappings.has(cells[0])) continue;
    if (!rows.has(cells[0])) rows.set(cells[0], []);
    rows.get(cells[0]).push(cells[1]);
  }
  return rows;
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectRuleIdsFromValue(value, ruleIds) {
  if (Array.isArray(value)) {
    for (const entry of value) collectRuleIdsFromValue(entry, ruleIds);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectRuleIdsFromValue(entry, ruleIds);
    return;
  }
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (/^(?:K|P|S|D|Z|R)-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}[a-z]?$/u.test(normalized)) {
    ruleIds.add(normalized);
  }
}

async function collectRuleEvidenceIds() {
  const ruleIds = new Set();
  const roots = [
    '.nimi/spec/runtime/kernel/tables',
    '.nimi/spec/platform/kernel/tables',
    '.nimi/spec/sdks/kernel/tables',
    '.nimi/spec/desktop/kernel/tables',
    '.nimi/spec/zhiyu/kernel/tables',
  ];

  async function walk(absDir) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || !/^rule-evidence.*\.ya?ml$/u.test(entry.name)) continue;
      collectRuleIdsFromValue(YAML.parse(await fs.readFile(absPath, 'utf8')), ruleIds);
    }
  }

  for (const root of roots) await walk(path.join(repoRoot, ...root.split('/')));
  return ruleIds;
}

async function collectNimiCanonicalRuleIds() {
  const documents = await collectAuthorityDocuments([
    ...scopeRoots['runtime-authority'],
    ...scopeRoots['consumer-authority'],
  ]);
  return new Set(documents
    .filter((document) => document.kind === 'markdown' && document.relPath.includes('/kernel/'))
    .flatMap((document) => document.rules.map((rule) => rule.id)));
}

async function resolveRealmCoreRuleInventory() {
  const candidates = [process.env.REALM_ROOT, path.dirname(repoRoot)]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));
  for (const candidate of [...new Set(candidates)]) {
    const contractPath = path.join(candidate, '.nimi/spec/realm/kernel/core-contract.md');
    const tablePath = path.join(candidate, '.nimi/spec/realm/kernel/tables/core-contract.yaml');
    try {
      const [contractText, tableText] = await Promise.all([
        fs.readFile(contractPath, 'utf8'),
        fs.readFile(tablePath, 'utf8'),
      ]);
      const declared = new Set(parseMarkdownRules({
        relPath: contractPath,
        text: contractText,
      }).map((rule) => rule.id));
      const registered = new Set();
      collectRuleIdsFromValue(YAML.parse(tableText), registered);
      return { declared, registered };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function traceabilityMappingFindings() {
  const findings = [];
  let text = null;
  try {
    text = await fs.readFile(path.join(repoRoot, ...ownerPaths.scenarioCatalog.split('/')), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') return [
      `[traceability] LAHC-T001 cannot read ${ownerPaths.scenarioCatalog}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (text !== null) {
    if (text.includes('pending_i0')) findings.push(
      `[traceability] LAHC-T002 ${ownerPaths.scenarioCatalog} must contain zero pending_i0 placeholders`,
    );
    const rows = parseTraceabilityRows(text);
    for (const [requirementId, expectedRuleIds] of expectedTraceabilityMappings) {
      const authorityCells = rows.get(requirementId) || [];
      if (authorityCells.length !== 1) {
        findings.push(`[traceability] LAHC-T003 ${requirementId} must have exactly one requirement coverage row`);
        continue;
      }
      const authorityCell = authorityCells[0];
      const actualRuleIds = extractCompactRuleIds(authorityCell);
      if (authorityCell.includes('pending_i0') || !sameOrderedValues(actualRuleIds, expectedRuleIds)) {
        findings.push(`[traceability] LAHC-T004 ${requirementId} mapping must be [${expectedRuleIds.join(', ')}], got [${actualRuleIds.join(', ')}]`);
      }
    }
  }

  const [declaredNimiRuleIds, registeredNimiRuleIds] = await Promise.all([
    collectNimiCanonicalRuleIds(),
    collectRuleEvidenceIds(),
  ]);
  let realmInventory;
  const checkedRuleIds = new Set();
  for (const [requirementId, ruleIds] of expectedTraceabilityMappings) {
    for (const ruleId of ruleIds) {
      if (checkedRuleIds.has(ruleId)) continue;
      checkedRuleIds.add(ruleId);
      if (ruleId.startsWith('R-')) {
        if (typeof realmInventory === 'undefined') realmInventory = await resolveRealmCoreRuleInventory();
        if (!realmInventory) {
          findings.push('[traceability] LAHC-T005 Realm core authority checkout is required via REALM_ROOT or the Nimi parent directory');
          continue;
        }
        if (!realmInventory.declared.has(ruleId)) {
          findings.push(`[traceability] LAHC-T006 ${requirementId} references undeclared Realm rule ${ruleId}`);
        }
        if (!realmInventory.registered.has(ruleId)) {
          findings.push(`[traceability] LAHC-T007 ${requirementId} references unregistered Realm rule ${ruleId}`);
        }
        continue;
      }
      if (!declaredNimiRuleIds.has(ruleId)) {
        findings.push(`[traceability] LAHC-T008 ${requirementId} references undeclared Nimi rule ${ruleId}`);
      }
      if (!registeredNimiRuleIds.has(ruleId)) {
        findings.push(`[traceability] LAHC-T009 ${requirementId} references unregistered Nimi rule ${ruleId}`);
      }
    }
  }
  return findings;
}

function relationRecordString(record) {
  return `AUTHORITY-RELATION subject=${record.subject} action=${record.action} object=${record.object} value=${record.value} polarity=${record.polarity}`;
}

function parseAuthorityRelation(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const relation = {
      subject: String(value.subject ?? '').trim().toLowerCase(),
      action: String(value.action ?? '').trim().toLowerCase(),
      object: String(value.object ?? '').trim().toLowerCase(),
      value: String(value.value ?? '').trim().toLowerCase(),
      polarity: String(value.polarity ?? '').trim().toLowerCase(),
    };
    return Object.values(relation).every(Boolean) && ['require', 'forbid'].includes(relation.polarity)
      ? relation
      : null;
  }
  const match = normalizeStatement(value).match(
    /^authority-relation subject=([a-z0-9.-]+) action=([a-z0-9.-]+) object=([a-z0-9.-]+) value=([a-z0-9.-]+) polarity=(require|forbid)$/u,
  );
  if (!match) return null;
  return {
    subject: match[1],
    action: match[2],
    object: match[3],
    value: match[4],
    polarity: match[5],
  };
}

function relationEquals(left, right) {
  return left.subject === right.subject
    && left.action === right.action
    && left.object === right.object
    && left.value === right.value
    && left.polarity === right.polarity;
}

function requiredActive(relation) {
  return {
    subject: relation.subject,
    action: relation.action,
    object: relation.object,
    value: relation.value,
    polarity: relation.polarity,
  };
}

function requiredPassive(relation) {
  return {
    subject: relation.object,
    action: relation.passiveAction,
    object: relation.subject,
    value: relation.value,
    polarity: relation.polarity,
  };
}

function inverseActive(relation) {
  return {
    subject: relation.inverseSubject,
    action: relation.action,
    object: relation.inverseObject,
    value: relation.inverseValue,
    polarity: relation.inversePolarity,
  };
}

function inversePassive(relation) {
  const inverse = inverseActive(relation);
  return {
    subject: inverse.object,
    action: relation.passiveAction,
    object: inverse.subject,
    value: inverse.value,
    polarity: inverse.polarity,
  };
}

function relationClassification(candidate, relation) {
  const active = requiredActive(relation);
  const passive = requiredPassive(relation);
  if (relationEquals(candidate, active) || relationEquals(candidate, passive)) return 'required';
  if (relationEquals(candidate, inverseActive(relation)) || relationEquals(candidate, inversePassive(relation))) return 'inverse';

  const activeGoverningKey = candidate.subject === active.subject
    && candidate.action === active.action
    && candidate.object === active.object;
  const passiveGoverningKey = candidate.subject === passive.subject
    && candidate.action === passive.action
    && candidate.object === passive.object;
  if (activeGoverningKey || passiveGoverningKey) return 'inverse';
  return 'unrelated';
}

function ownerLabel(owner) {
  return owner.kind === 'markdown'
    ? `${owner.relPath}#${owner.ruleId}`
    : `${owner.relPath}#${owner.field}=${owner.value}`;
}

function collectAuthorityRelations(documents) {
  const entries = [];
  for (const document of documents) {
    if (document.kind === 'markdown') {
      for (const rule of document.rules) {
        for (const statement of rule.statements) {
          const relation = parseAuthorityRelation(statement.text);
          if (!relation) continue;
          entries.push({
            relation,
            owner: markdownOwner(document.relPath, rule.id),
            location: `${document.relPath}:${statement.line}#${rule.id}`,
          });
        }
      }
      continue;
    }
    for (const record of document.records) {
      const rawRelations = record.value?.authority_relations;
      if (!Array.isArray(rawRelations)) continue;
      for (const value of rawRelations) {
        const relation = parseAuthorityRelation(value);
        if (!relation) continue;
        entries.push({
          relation,
          owner: yamlOwner(document.relPath, record.identifier.field, record.identifier.value),
          location: `${document.relPath}#${record.id}`,
        });
      }
    }
  }
  return entries;
}

function relationBelongsToOwner(entry, owner) {
  return entry.owner.kind === owner.kind
    && entry.owner.relPath === owner.relPath
    && (owner.kind === 'markdown'
      ? entry.owner.ruleId === owner.ruleId
      : entry.owner.field === owner.field && entry.owner.value === owner.value);
}

function evaluateRelationRequirements(findings, scope, documents, requirements) {
  const entries = collectAuthorityRelations(documents);
  for (const requirementEntry of requirements) {
    const expected = requiredActive(requirementEntry.relation);
    for (const owner of requirementEntry.owners) {
      if (!entries.some((entry) => (
        relationBelongsToOwner(entry, owner) && relationEquals(entry.relation, expected)
      ))) {
        findings.push(
          `[${scope}] ${requirementEntry.id} ${ownerLabel(owner)} must own canonical relation: ${relationRecordString(expected)}`,
        );
      }
    }
    for (const entry of entries) {
      if (relationClassification(entry.relation, requirementEntry.relation) !== 'inverse') continue;
      findings.push(
        `[${scope}] ${requirementEntry.id}-INV contradictory relation at ${entry.location}: ${relationRecordString(entry.relation)}`,
      );
    }
  }
}

function statementUnits(documents) {
  const units = [];
  for (const document of documents) {
    if (document.kind === 'markdown') {
      for (const rule of document.rules) {
        for (const statement of rule.statements) {
          units.push({
            relPath: document.relPath,
            owner: rule.id,
            line: statement.line,
            normalized: statement.normalized,
          });
        }
      }
    } else {
      for (const record of document.records) {
        units.push({
          relPath: document.relPath,
          owner: record.id,
          line: null,
          normalized: record.normalized,
        });
      }
    }
  }
  return units;
}

function legacyHmacConflict(unit) {
  if (unit.owner === 'key=sourceMaterializationPacketHmacSecret') return true;
  return unit.normalized.includes('sourcematerializationpackethmacsecret')
    && /\b(?:is runtime-owned verifier material for realm-issued source materialization packet hmac proofs|runtimeagent may consume only the resolved runtime config value)\b/iu.test(unit.normalized);
}

function legacySystemPromptConflict(unit) {
  return /\bguide system prompt are ordinary source content carried on the admitted sourcematerializationpacket\b/iu.test(unit.normalized)
    || /\bauthored alongside\b[^.;]*\bsystempromptbase\b/iu.test(unit.normalized)
    || /\bper-turn prompt-context path\b[^.;]*\bsystempromptbase already uses\b/iu.test(unit.normalized);
}

function legacyConsumerContextConflict(unit) {
  return /\bdesktop\/consumer attaches\b[^.;]*\bper-turn context\b/iu.test(unit.normalized);
}

function addLegacyConflicts(findings, scope, units, id, description, predicate) {
  const seen = new Set();
  for (const unit of units) {
    if (!predicate(unit)) continue;
    const location = unit.line === null
      ? `${unit.relPath}#${unit.owner}`
      : `${unit.relPath}:${unit.line}#${unit.owner}`;
    if (seen.has(location)) continue;
    seen.add(location);
    findings.push(`[${scope}] ${id} conflicting authority at ${location}: ${description}`);
  }
}

function runtimeAuthorityFindings(documents) {
  const findings = [];
  evaluateRelationRequirements(findings, 'runtime-authority', documents, runtimeRequirements);
  const units = statementUnits(documents);
  addLegacyConflicts(findings, 'runtime-authority', units, 'LAHC-R101', 'HMAC verifier/proof authority remains active', legacyHmacConflict);
  addLegacyConflicts(findings, 'runtime-authority', units, 'LAHC-R102', 'packet/systemPromptBase prompt authority remains active', legacySystemPromptConflict);
  addLegacyConflicts(findings, 'runtime-authority', units, 'LAHC-R103', 'consumer-attached LocalAgent context authority remains active', legacyConsumerContextConflict);
  return findings;
}

function consumerAuthorityFindings(documents) {
  const findings = [];
  evaluateRelationRequirements(findings, 'consumer-authority', documents, consumerRequirements);
  evaluateRelationRequirements(findings, 'consumer-authority', documents, conversationReportRequirements);

  if (!findYamlRecord(documents, ownerPaths.desktopSourceActions, 'machine_id', 'desktop_realm_source_local_materialization_action_model')) {
    findings.push('[consumer-authority] LAHC-C018 .nimi/spec/desktop/kernel/tables/realm-source-materialization-actions.yaml must own record machine_id=desktop_realm_source_local_materialization_action_model');
  }
  if (documents.some((document) => document.relPath === ownerPaths.retiredDesktopPersonaActions)) {
    findings.push(`[consumer-authority] LAHC-C101 conflicting authority at ${ownerPaths.retiredDesktopPersonaActions}: persona-only materialization action authority remains active`);
  }
  if (documents.some((document) => document.relPath === ownerPaths.incorrectDesktopSourceActions)) {
    findings.push(`[consumer-authority] LAHC-C102 conflicting authority at ${ownerPaths.incorrectDesktopSourceActions}: shortened source-materialization owner path is not admitted by census`);
  }
  for (const document of documents) {
    const incorrectRecord = document.records?.find((record) => (
      record.identifier.field === 'machine_id'
      && record.identifier.value === 'desktop_source_local_materialization_action_model'
    ));
    if (incorrectRecord) {
      findings.push(`[consumer-authority] LAHC-C103 conflicting authority at ${document.relPath}#${incorrectRecord.id}: shortened source materialization machine id is not admitted by census`);
    }
  }
  return findings;
}

async function main() {
  const selectedScope = parseScope(process.argv.slice(2));
  if (selectedScope === 'runtime-materialization') {
    let findings;
    try {
      findings = await runtimeMaterializationCodeFindings(repoRoot);
    } catch (error) {
      process.stderr.write(`local-agent-full-chain-hardcut checker error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    if (findings.length > 0) {
      process.stderr.write(`local-agent-full-chain-hardcut ${selectedScope} failed (${findings.length} finding(s)):\n`);
      for (const finding of findings) process.stderr.write(`- ${finding}\n`);
      process.exit(1);
    }
    process.stdout.write(`local-agent-full-chain-hardcut ${selectedScope}: OK\n`);
    return;
  }
  if (selectedScope === 'runtime-consumer') {
    let findings;
    try {
      findings = await runtimeContextConsumerCodeFindings(repoRoot);
    } catch (error) {
      process.stderr.write(`local-agent-full-chain-hardcut checker error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    if (findings.length > 0) {
      process.stderr.write(`local-agent-full-chain-hardcut ${selectedScope} failed (${findings.length} finding(s)):\n`);
      for (const finding of findings) process.stderr.write(`- ${finding}\n`);
      process.exit(1);
    }
    process.stdout.write(`local-agent-full-chain-hardcut ${selectedScope}: OK\n`);
    return;
  }
  const scopes = selectedScope === 'authority' || selectedScope === 'all'
    ? ['runtime-authority', 'consumer-authority']
    : [selectedScope];
  const findings = [];

  try {
    runAuthorityAdversarialSelfTests({
      consumerAuthorityFindings,
      extractCompactRuleIds,
      findYamlRecord,
      inverseActive,
      inversePassive,
      ownerLabel,
      parseMarkdownRules,
      parseTraceabilityRows,
      parseYamlRecords,
      relationEquals,
      relationRecordString,
      requiredActive,
      runtimeAuthorityFindings,
      sameOrderedValues,
    });
    for (const scope of scopes) {
      const documents = await collectAuthorityDocuments(scopeRoots[scope]);
      findings.push(...(scope === 'runtime-authority'
        ? runtimeAuthorityFindings(documents)
        : consumerAuthorityFindings(documents)));
    }
    if (selectedScope === 'authority' || selectedScope === 'all') findings.push(...await traceabilityMappingFindings());
    if (selectedScope === 'all') {
      findings.push(...await runtimeMaterializationCodeFindings(repoRoot));
      findings.push(...await runtimeContextConsumerCodeFindings(repoRoot));
      findings.push(...await fullScopeAppCodeFindings(repoRoot));
    }
  } catch (error) {
    process.stderr.write(`local-agent-full-chain-hardcut checker error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }

  if (findings.length > 0) {
    process.stderr.write(`local-agent-full-chain-hardcut ${selectedScope} failed (${findings.length} finding(s)):\n`);
    for (const finding of findings) process.stderr.write(`- ${finding}\n`);
    process.exit(1);
  }

  process.stdout.write(`local-agent-full-chain-hardcut ${selectedScope}: OK\n`);
}

await main();
