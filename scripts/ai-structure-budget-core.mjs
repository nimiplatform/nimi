#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import YAML from 'yaml';

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, '/').trim();
  let pattern = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];
    if (current === '*') {
      if (next === '*') {
        const afterNext = normalized[index + 2];
        if (afterNext === '/') {
          pattern += '(?:.*/)?';
          index += 2;
        } else {
          pattern += '.*';
          index += 1;
        }
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if (current === '?') {
      pattern += '[^/]';
      continue;
    }
    pattern += escapeRegex(current);
  }
  pattern += '$';
  return new RegExp(pattern);
}

function compileMatchers(patterns) {
  return (patterns || []).map((pattern) => ({
    pattern,
    regex: globToRegExp(pattern),
  }));
}

function normalizePathPrefix(input) {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function matchesAny(filePath, matchers) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const matcher of matchers) {
    if (matcher.regex.test(normalized)) {
      return true;
    }
  }
  return false;
}

function parseDateMaybe(input) {
  if (!input) {
    return null;
  }
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const parsed = new Date(String(input));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function loadBudgetConfig(cwd, relativePath) {
  const configPath = path.join(cwd, relativePath);
  if (!fs.existsSync(configPath)) {
    throw new Error(`budget config not found: ${relativePath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`invalid budget config format: ${relativePath}`);
  }
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error(`budget config missing rules: ${relativePath}`);
  }
  return {
    configPath: relativePath,
    parsed,
  };
}

function listTrackedFiles(cwd) {
  const output = execSync('git ls-files -z', {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split('\u0000')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function toSeverity(value, warningThreshold, errorThreshold) {
  if (typeof errorThreshold === 'number' && value >= errorThreshold) {
    return 'error';
  }
  if (typeof warningThreshold === 'number' && value >= warningThreshold) {
    return 'warning';
  }
  return 'none';
}

function normalizeLines(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gmu, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isDisallowedForwardingShell(filePath, source, allowedBasenames) {
  const basename = path.basename(filePath);
  if (allowedBasenames.has(basename)) {
    return false;
  }

  const lines = normalizeLines(source);
  if (lines.length === 0) {
    return false;
  }

  const tsPatterns = [
    /^export\s+\*\s+from\s+['"].+['"];?$/u,
    /^export\s+\*\s+as\s+\w+\s+from\s+['"].+['"];?$/u,
    /^export\s+(type\s+)?\{[^}]+\}\s+from\s+['"].+['"];?$/u,
  ];
  const rustPatterns = [
    /^mod\s+\w+;$/u,
    /^pub\s+mod\s+\w+;$/u,
    /^use\s+.+;$/u,
    /^pub(\([^)]*\))?\s+use\s+.+;$/u,
  ];

  return lines.every((line) => tsPatterns.some((pattern) => pattern.test(line)) || rustPatterns.some((pattern) => pattern.test(line)));
}

function resolveRule(filePath, compiledRules) {
  for (const rule of compiledRules) {
    if (matchesAny(filePath, rule.matchers)) {
      return rule;
    }
  }
  return null;
}

function describeDepthSubject(filePath, depthBase) {
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  if (!depthBase) {
    return {
      depthBase: '.',
      depthSubject: normalizedFilePath,
      depth: normalizedFilePath.split('/').length,
    };
  }

  const normalizedBase = normalizePathPrefix(depthBase);
  const prefix = `${normalizedBase}/`;
  if (!normalizedFilePath.startsWith(prefix)) {
    throw new Error(`depth_base "${normalizedBase}" does not match file "${normalizedFilePath}"`);
  }

  const depthSubject = normalizedFilePath.slice(prefix.length);
  return {
    depthBase: normalizedBase,
    depthSubject,
    depth: depthSubject ? depthSubject.split('/').length : 0,
  };
}

function buildWaivers(waivers) {
  return (waivers || []).map((waiver) => ({
    ...waiver,
    matcher: globToRegExp(String(waiver.pattern || '').trim()),
    checks: new Set((waiver.checks || []).map((value) => String(value).trim()).filter(Boolean)),
    hasUntil: typeof waiver.until !== 'undefined' && String(waiver.until).trim().length > 0,
    untilDate: parseDateMaybe(waiver.until),
  }));
}

function findWaiver(filePath, check, waivers) {
  for (const waiver of waivers) {
    if (!waiver.matcher.test(filePath)) {
      continue;
    }
    if (waiver.checks.size > 0 && !waiver.checks.has(check)) {
      continue;
    }
    return waiver;
  }
  return null;
}

function getWaiverDisposition(waiver) {
  if (!waiver) {
    return 'none';
  }
  if (!waiver.hasUntil) {
    return 'active';
  }
  if (waiver.untilDate && waiver.untilDate.getTime() >= Date.now()) {
    return 'active';
  }
  if (waiver.untilDate && waiver.untilDate.getTime() < Date.now()) {
    return 'expired';
  }
  return 'none';
}

function compareRows(left, right) {
  const severityRank = {
    error: 2,
    warning: 1,
    none: 0,
  };
  if (severityRank[left.severity] !== severityRank[right.severity]) {
    return severityRank[right.severity] - severityRank[left.severity];
  }
  if (left.check === 'depth' && right.check === 'depth' && left.depth !== right.depth) {
    return right.depth - left.depth;
  }
  return left.file.localeCompare(right.file);
}

export function evaluateAiStructureBudget(options = {}) {
  const cwd = options.cwd || process.cwd();
  const configRelativePath = options.configRelativePath || 'dev/config/ai-structure-budget.yaml';
  const { parsed, configPath } = loadBudgetConfig(cwd, configRelativePath);
  const excludeMatchers = compileMatchers(parsed.exclude || []);
  const compiledRules = (parsed.rules || []).map((rule) => ({
    id: String(rule.id || '').trim(),
    warningDepth: Number(rule.warning_depth),
    errorDepth: Number(rule.error_depth),
    depthBase: normalizePathPrefix(rule.depth_base),
    matchers: compileMatchers(rule.include || []),
  }));
  const waivers = buildWaivers(parsed.waivers || []);
  const allowedForwardingShells = new Set((parsed.allowed_forwarding_shells || []).map((value) => String(value).trim()).filter(Boolean));

  const files = listTrackedFiles(cwd);
  const rows = [];
  const warnings = [];
  const errors = [];
  const waivedErrors = [];
  const expiredWaivers = [];
  let analyzedFiles = 0;

  for (const relativePath of files) {
    if (matchesAny(relativePath, excludeMatchers)) {
      continue;
    }

    const rule = resolveRule(relativePath, compiledRules);
    if (!rule) {
      continue;
    }

    const absolutePath = path.join(cwd, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }
    analyzedFiles += 1;

    const depthInfo = describeDepthSubject(relativePath, rule.depthBase);
    const depth = depthInfo.depth;
    const depthSeverity = toSeverity(depth, rule.warningDepth, rule.errorDepth);
    if (depthSeverity !== 'none') {
      const waiver = findWaiver(relativePath, 'depth', waivers);
      const row = {
        file: relativePath,
        ruleId: rule.id,
        check: 'depth',
        severity: depthSeverity,
        depth,
        depthBase: depthInfo.depthBase,
        depthSubject: depthInfo.depthSubject,
        warningDepth: rule.warningDepth,
        errorDepth: rule.errorDepth,
        waiver,
      };
      rows.push(row);
      if (depthSeverity === 'warning') {
        warnings.push(row);
      } else if (getWaiverDisposition(waiver) === 'active') {
        waivedErrors.push(row);
      } else if (getWaiverDisposition(waiver) === 'expired') {
        expiredWaivers.push(row);
      } else {
        errors.push(row);
      }
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    if (!isDisallowedForwardingShell(relativePath, source, allowedForwardingShells)) {
      continue;
    }

    const waiver = findWaiver(relativePath, 'forwarding_shell', waivers);
    const row = {
      file: relativePath,
      ruleId: rule.id,
      check: 'forwarding_shell',
      severity: 'error',
      basename: path.basename(relativePath),
      waiver,
    };
    rows.push(row);
    if (getWaiverDisposition(waiver) === 'active') {
      waivedErrors.push(row);
    } else if (getWaiverDisposition(waiver) === 'expired') {
      expiredWaivers.push(row);
    } else {
      errors.push(row);
    }
  }

  rows.sort(compareRows);
  warnings.sort(compareRows);
  errors.sort(compareRows);
  waivedErrors.sort(compareRows);
  expiredWaivers.sort(compareRows);

  return {
    configPath,
    totalTrackedFiles: files.length,
    analyzedFiles,
    rows,
    warnings,
    errors,
    waivedErrors,
    expiredWaivers,
  };
}
