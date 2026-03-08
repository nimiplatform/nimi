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
  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const next = normalized[i + 1];
    if (current === '*') {
      if (next === '*') {
        const afterNext = normalized[i + 2];
        if (afterNext === '/') {
          pattern += '(?:.*/)?';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
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

function matchesAny(filePath, matchers) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const matcher of matchers) {
    if (matcher.regex.test(normalized)) {
      return true;
    }
  }
  return false;
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

function maxSeverity(left, right) {
  const rank = {
    none: 0,
    warning: 1,
    error: 2,
  };
  return rank[left] >= rank[right] ? left : right;
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

function countLines(buffer) {
  if (!buffer || buffer.length === 0) {
    return 0;
  }
  let lines = 1;
  for (const byte of buffer) {
    if (byte === 10) {
      lines += 1;
    }
  }
  return lines;
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
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error(`budget config missing profiles: ${relativePath}`);
  }
  const defaultProfile = String(parsed.default_profile || 'production');
  if (!parsed.profiles[defaultProfile]) {
    throw new Error(`default profile not found in profiles: ${defaultProfile}`);
  }
  return {
    configPath: relativePath,
    parsed,
    defaultProfile,
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

function resolveProfile(filePath, classifierMatchers, defaultProfile) {
  for (const classifier of classifierMatchers) {
    if (matchesAny(filePath, classifier.matchers)) {
      return classifier.profile;
    }
  }
  return defaultProfile;
}

function buildWaiverMap(waivers) {
  const map = new Map();
  for (const waiver of waivers || []) {
    if (!waiver || typeof waiver !== 'object') {
      continue;
    }
    const filePath = String(waiver.path || '').trim();
    if (!filePath) {
      continue;
    }
    map.set(filePath, {
      path: filePath,
      reason: String(waiver.reason || '').trim(),
      until: parseDateMaybe(waiver.until),
    });
  }
  return map;
}

function waiverAllowedForProfile(profileId) {
  return profileId === 'tests_and_scripts' || profileId === 'generated';
}

export function evaluateAiContextBudget(options = {}) {
  const cwd = options.cwd || process.cwd();
  const configRelativePath = options.configRelativePath || 'dev/config/ai-context-budget.yaml';
  const { parsed, defaultProfile, configPath } = loadBudgetConfig(cwd, configRelativePath);

  const excludeMatchers = compileMatchers(parsed.exclude || []);
  const classifierMatchers = Object.entries(parsed.classifiers || {}).map(([profile, patterns]) => ({
    profile,
    matchers: compileMatchers(patterns || []),
  }));
  const waiverMap = buildWaiverMap(parsed.waivers || []);

  const files = listTrackedFiles(cwd);
  const rows = [];
  const skippedMissing = [];
  const invalidWaivers = [];

  for (const [filePath, waiver] of waiverMap.entries()) {
    const absolutePath = path.join(cwd, filePath);
    if (!fs.existsSync(absolutePath)) {
      invalidWaivers.push({
        file: filePath,
        reason: waiver.reason,
        kind: 'missing',
        detail: 'waiver points to a missing path',
      });
      continue;
    }
    if (matchesAny(filePath, excludeMatchers)) {
      invalidWaivers.push({
        file: filePath,
        reason: waiver.reason,
        kind: 'excluded',
        detail: 'waiver targets an excluded path',
      });
      continue;
    }
    const profileId = resolveProfile(filePath, classifierMatchers, defaultProfile);
    if (!waiverAllowedForProfile(profileId)) {
      invalidWaivers.push({
        file: filePath,
        reason: waiver.reason,
        kind: 'forbidden_profile',
        detail: `waivers are forbidden for profile ${profileId}`,
      });
    }
  }

  for (const relativePath of files) {
    if (matchesAny(relativePath, excludeMatchers)) {
      continue;
    }

    const absolutePath = path.join(cwd, relativePath);
    if (!fs.existsSync(absolutePath)) {
      skippedMissing.push(relativePath);
      continue;
    }

    const profileId = resolveProfile(relativePath, classifierMatchers, defaultProfile);
    const profile = parsed.profiles[profileId] || parsed.profiles[defaultProfile];
    if (!profile) {
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    const lines = countLines(buffer);
    const bytes = buffer.byteLength;

    const linesSeverity = toSeverity(lines, profile.warning_lines, profile.error_lines);
    const bytesSeverity = toSeverity(bytes, profile.warning_bytes, profile.error_bytes);
    const severity = maxSeverity(linesSeverity, bytesSeverity);

    const waiver = waiverMap.get(relativePath) || null;
    const waiverExpired = waiver?.until ? waiver.until.getTime() < Date.now() : false;
    const waived = Boolean(waiver) && !waiverExpired;

    rows.push({
      file: relativePath,
      profile: profileId,
      lines,
      bytes,
      severity,
      linesSeverity,
      bytesSeverity,
      warningLines: profile.warning_lines,
      errorLines: profile.error_lines,
      warningBytes: profile.warning_bytes,
      errorBytes: profile.error_bytes,
      waiver,
      waiverExpired,
      waived,
    });
  }

  const warnings = rows.filter((row) => row.severity === 'warning');
  const errors = rows.filter((row) => row.severity === 'error' && !row.waived);
  const waivedErrors = rows.filter((row) => row.severity === 'error' && row.waived);
  const expiredWaivers = rows.filter((row) => row.severity === 'error' && row.waiver && row.waiverExpired);

  rows.sort((left, right) => {
    if (right.lines !== left.lines) {
      return right.lines - left.lines;
    }
    return right.bytes - left.bytes;
  });

  return {
    configPath,
    totalTrackedFiles: files.length,
    analyzedFiles: rows.length,
    skippedMissing,
    rows,
    warnings,
    errors,
    waivedErrors,
    expiredWaivers,
    invalidWaivers,
  };
}

export function formatBytes(bytes) {
  const kb = 1024;
  const mb = kb * 1024;
  if (bytes >= mb) {
    return `${(bytes / mb).toFixed(1)}MB`;
  }
  if (bytes >= kb) {
    return `${(bytes / kb).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}
