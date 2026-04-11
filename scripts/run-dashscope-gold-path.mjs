#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareLiveAudioFixtures, mergeMissingEnv } from './lib/live-audio-fixtures.mjs';
import { buildMergedEnv } from './lib/live-env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROFILE_PATH = path.join(REPO_ROOT, 'config', 'live', 'dashscope-gold-path.env');
const DEFAULT_ENV_FILE = path.join(REPO_ROOT, '.env');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, '.local', 'report', 'ai-gold-path-report.yaml');

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parseArgs() {
  const profilePath = readArg('--profile');
  const envFile = readArg('--env-file');
  const reportPath = readArg('--report');
  const fixturePath = readArg('--fixture');
  return {
    profilePath: profilePath
      ? (path.isAbsolute(profilePath) ? profilePath : path.resolve(REPO_ROOT, profilePath))
      : DEFAULT_PROFILE_PATH,
    envFile: envFile
      ? (path.isAbsolute(envFile) ? envFile : path.resolve(REPO_ROOT, envFile))
      : DEFAULT_ENV_FILE,
    reportPath: reportPath
      ? (path.isAbsolute(reportPath) ? reportPath : path.resolve(REPO_ROOT, reportPath))
      : DEFAULT_REPORT_PATH,
    fixturePath: fixturePath
      ? (path.isAbsolute(fixturePath) ? fixturePath : path.resolve(REPO_ROOT, fixturePath))
      : '',
    dryRun: hasFlag('--dry-run'),
  };
}

function requireEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) {
    throw new Error(`missing ${key}; dashscope gold-path runner does not read DASHSCOPE_API_KEY or legacy aliases`);
  }
  return value;
}

function buildResolvedEnv(options) {
  const merged = buildMergedEnv({
    baseEnv: process.env,
    filePaths: [options.profilePath, options.envFile],
  });
  const preparedAudio = prepareLiveAudioFixtures({
    cwd: REPO_ROOT,
    env: merged,
    strict: true,
  });
  const resolved = mergeMissingEnv(merged, preparedAudio.payload);

  requireEnv(resolved, 'NIMI_LIVE_DASHSCOPE_API_KEY');
  requireEnv(resolved, 'NIMI_LIVE_GOLD_SUBJECT_USER_ID');
  return resolved;
}

function toInterestingEnv(env) {
  const keys = [
    'NIMI_LIVE_DASHSCOPE_API_KEY',
    'NIMI_LIVE_GOLD_SUBJECT_USER_ID',
    'NIMI_LIVE_DASHSCOPE_BASE_URL',
    'NIMI_LIVE_DASHSCOPE_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_EMBED_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_IMAGE_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_TTS_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_STT_MODEL_ID',
    'NIMI_LIVE_STT_AUDIO_PATH',
    'NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_PATH',
    'NIMI_LIVE_DASHSCOPE_VOICE_DESIGN_MODEL_ID',
    'NIMI_LIVE_DASHSCOPE_VOICE_DESIGN_MODEL_ID_TARGET_MODEL_ID',
  ];
  const snapshot = {};
  for (const key of keys) {
    const value = String(env[key] || '').trim();
    snapshot[key] = key.endsWith('_API_KEY')
      ? (value ? '<set>' : '<missing>')
      : value;
  }
  return snapshot;
}

function main() {
  const options = parseArgs();
  const env = buildResolvedEnv(options);
  const command = [
    'node',
    'scripts/run-ai-gold-path.mjs',
    '--provider',
    'dashscope',
    '--report',
    options.reportPath,
  ];
  if (options.fixturePath) {
    command.push('--fixture', options.fixturePath);
  }

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      command,
      env: toInterestingEnv(env),
      profilePath: options.profilePath,
      envFile: existsSync(options.envFile) ? options.envFile : null,
    }, null, 2)}\n`);
    return;
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`${detail}\n`);
  process.exit(1);
}
