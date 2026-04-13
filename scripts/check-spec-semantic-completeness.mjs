#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const specRoot = path.join(cwd, '.nimi', 'spec');
const allowlistPath = path.join(cwd, 'scripts', 'spec-semantic-completeness-allowlist.json');

const RULE_HEADING_RE = /^##\s+((?:K|S|D|P|R|F)-[A-Z]+-\d{3})\b/gmu;
const RULE_REF_RE = /\b(?:K|S|D|P|R|F)-[A-Z]+-\d{3}\b/g;
const RULELIKE_NON_FAMILY_RE = /(?<![KSDPRF]-)\b[A-Z][A-Z0-9]{1,15}(?:-[A-Z0-9]{1,15})?-\d{3}[a-z]?\b/g;
const COMPANION_RULE_HEADING_RE = /^##\s+(?:K|S|D|P|R|F)-[A-Z]+-\d{3}\b/gmu;
const ANCHOR_RULE_RE = /\b(?:K|S|D|P|R|F)-[A-Z]+-\d{3}\b/g;

const LEGACY_PREFIXES = [
  'CONN',
  'SDKR',
  'SDKREALM',
  'SDKMOD',
  'SDKTEST',
  'CODEGEN',
  'CFG',
  'NIMI',
  'MMPROV',
  'MMGATE',
  'PROTO',
];

const LEGACY_INLINE_RE = new RegExp(
  `(?<![KSDPRF]-)\\b(?:${LEGACY_PREFIXES.join('|')})-\\d{3}\\b`,
  'g',
);

const allowedNonRuleTokenPatterns = [];
const allowedUnresolvedRuleRefs = [];

let failed = false;

function fail(msg) {
  failed = true;
  console.error(`ERROR: ${msg}`);
}

function readFile(relPath) {
  return fs.readFileSync(path.join(cwd, relPath), 'utf8');
}

function stripMarkdownFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

function stripIgnoredMetadataLines(content) {
  return content
    .replace(/^\s*(?:id|contract_id):\s*.*$/gmu, '')
    .replace(/^Contract:\s+`[^`]+`\s*$/gmu, '');
}

function readRuleScanContent(relPath) {
  let content = readFile(relPath);
  if (relPath.endsWith('.md')) {
    content = stripMarkdownFrontmatter(content);
  }
  return stripIgnoredMetadataLines(content);
}

function loadAllowlist() {
  if (!fs.existsSync(allowlistPath)) {
    fail(`missing allowlist file: ${path.relative(cwd, allowlistPath)}`);
    return;
  }

  let raw;
  try {
    raw = fs.readFileSync(allowlistPath, 'utf8');
  } catch (err) {
    fail(`failed to read allowlist file: ${String(err)}`);
    return;
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    fail(`failed to parse allowlist JSON: ${String(err)}`);
    return;
  }

  const patternSpecs = Array.isArray(doc?.allowed_non_rule_token_patterns)
    ? doc.allowed_non_rule_token_patterns
    : [];
  for (const spec of patternSpecs) {
    const text = String(spec || '').trim();
    if (!text) continue;
    try {
      allowedNonRuleTokenPatterns.push(new RegExp(text, 'u'));
    } catch (err) {
      fail(`invalid allowlist regex pattern: ${text} (${String(err)})`);
    }
  }

  const unresolvedSpecs = Array.isArray(doc?.allowed_unresolved_rule_refs)
    ? doc.allowed_unresolved_rule_refs
    : [];
  for (const item of unresolvedSpecs) {
    const file = String(item?.file || '').trim();
    const rulePrefix = String(item?.rule_prefix || '').trim();
    if (!file || !rulePrefix) {
      fail(`invalid allowed_unresolved_rule_refs entry: ${JSON.stringify(item)}`);
      continue;
    }
    allowedUnresolvedRuleRefs.push({ file, rulePrefix });
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function toRel(absPath) {
  return path.relative(cwd, absPath).split(path.sep).join('/');
}

function listSpecFiles() {
  return walk(specRoot)
    .map(toRel)
    .filter((rel) => rel.endsWith('.md') || rel.endsWith('.yaml') || rel.endsWith('.yml'));
}

function listKernelContractFiles() {
  return walk(specRoot)
    .map(toRel)
    .filter((rel) => rel.includes('/kernel/'))
    .filter((rel) => rel.endsWith('.md'))
    .filter((rel) => !rel.includes('/kernel/generated/'))
    .filter((rel) => !rel.includes('/kernel/companion/'));
}

function isAllowedNonRuleToken(token) {
  for (const pattern of allowedNonRuleTokenPatterns) {
    if (pattern.test(token)) return true;
  }
  return false;
}

function isAllowedUnresolvedRuleRef(rel, ruleId) {
  for (const entry of allowedUnresolvedRuleRefs) {
    if (entry.file === rel && ruleId.startsWith(entry.rulePrefix)) return true;
  }
  return false;
}

function collectKernelRuleDefinitions(kernelFiles) {
  const definitionMap = new Map();
  for (const rel of kernelFiles) {
    const content = readRuleScanContent(rel);
    for (const match of content.matchAll(RULE_HEADING_RE)) {
      const ruleId = match[1];
      if (definitionMap.has(ruleId)) {
        fail(`duplicate kernel Rule ID definition: ${ruleId} in ${rel} (first defined in ${definitionMap.get(ruleId)})`);
      } else {
        definitionMap.set(ruleId, rel);
      }
    }
  }
  return definitionMap;
}

function checkRuleReferencesResolvable(specFiles, definitionMap) {
  for (const rel of specFiles) {
    const content = readRuleScanContent(rel);

    for (const match of content.matchAll(RULE_REF_RE)) {
      const ruleId = match[0];
      if (!definitionMap.has(ruleId) && !isAllowedUnresolvedRuleRef(rel, ruleId)) {
        fail(`${rel} references undefined Rule ID: ${ruleId}`);
      }
    }

    for (const match of content.matchAll(RULELIKE_NON_FAMILY_RE)) {
      const token = match[0];
      if (isAllowedNonRuleToken(token)) continue;
      fail(`${rel} contains unresolved rule-like token (non-kernel): ${token}`);
    }
  }
}

function checkLegacyLocalIdsRetired(specFiles) {
  for (const rel of specFiles) {
    const content = readRuleScanContent(rel);
    const tokens = new Set((content.match(LEGACY_INLINE_RE) || []));
    for (const token of tokens) {
      fail(`${rel} contains retired legacy ID token: ${token}`);
    }
  }
}

function checkCompanionConstraints(companionFiles, definitionMap) {
  for (const rel of companionFiles) {
    const content = readFile(rel);

    if (COMPANION_RULE_HEADING_RE.test(content)) {
      fail(`${rel} defines Rule heading(s); companion docs must not define kernel rules`);
    }

    const sectionHeadings = [...content.matchAll(/^##\s+.+$/gmu)];
    if (sectionHeadings.length === 0) {
      fail(`${rel} must contain at least one section heading with Anchors`);
      continue;
    }

    for (let i = 0; i < sectionHeadings.length; i += 1) {
      const start = sectionHeadings[i].index;
      const end = i + 1 < sectionHeadings.length ? sectionHeadings[i + 1].index : content.length;
      const section = content.slice(start, end);
      const heading = sectionHeadings[i][0];

      const anchorLine = section.match(/^Anchors:\s*(.+)$/mu);
      if (!anchorLine) {
        fail(`${rel} section missing Anchors line: ${heading}`);
        continue;
      }

      const anchorIds = [...anchorLine[1].matchAll(ANCHOR_RULE_RE)].map((m) => m[0]);
      if (anchorIds.length === 0) {
        fail(`${rel} section has Anchors but no Rule IDs: ${heading}`);
        continue;
      }

      for (const anchorId of anchorIds) {
        if (!definitionMap.has(anchorId)) {
          fail(`${rel} section anchors undefined Rule ID: ${anchorId}`);
        }
      }
    }
  }
}

function checkGeneratedNoLegacyIdOutput() {
  const targets = [
    'scripts/generate-spec-human-doc.mjs',
    '.nimi/spec/generated/nimi-spec.md',
  ];

  for (const rel of targets) {
    if (!fs.existsSync(path.join(cwd, rel))) {
      fail(`missing generated pipeline target: ${rel}`);
      continue;
    }
    const content = readFile(rel);
    const tokens = new Set((content.match(LEGACY_INLINE_RE) || []));
    for (const token of tokens) {
      fail(`${rel} still contains retired legacy ID token: ${token}`);
    }
  }
}

function main() {
  loadAllowlist();

  const specFiles = listSpecFiles();
  const kernelFiles = listKernelContractFiles();
  const companionFiles = specFiles.filter((rel) => rel.includes('/kernel/companion/') && rel.endsWith('.md'));
  const definitionMap = collectKernelRuleDefinitions(kernelFiles);

  if (definitionMap.size === 0) {
    fail('no kernel rule definitions found under .nimi/spec/**/kernel/*.md');
  }

  checkRuleReferencesResolvable(specFiles, definitionMap);
  checkLegacyLocalIdsRetired(specFiles);
  checkCompanionConstraints(companionFiles, definitionMap);
  checkGeneratedNoLegacyIdOutput();

  if (failed) process.exit(1);
  console.log(
    `spec-semantic-completeness: OK (${definitionMap.size} rules, ${specFiles.length} spec files, ${companionFiles.length} companion docs)`,
  );
}

main();
