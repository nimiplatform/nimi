#!/usr/bin/env node

import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'dev', 'report', 'live-audio-fixtures');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18456;

const STT_TEXT = 'Hello from Nimi gold path. DashScope speech transcription should hear this sentence clearly.';
const VOICE_CLONE_TEXT = [
  'Hello from Nimi voice clone gold path.',
  'This reference sample is deterministic and generated on the local machine.',
  'DashScope should be able to create a reusable cloned voice asset from this recording.',
].join(' ');

const FIXTURES = [
  {
    pathName: '/dashscope-stt-sample.wav',
    fileName: 'dashscope-stt-sample.wav',
    voice: 'Albert',
    rate: '180',
    text: STT_TEXT,
  },
  {
    pathName: '/dashscope-voice-reference.wav',
    fileName: 'dashscope-voice-reference.wav',
    voice: 'Albert',
    rate: '170',
    text: VOICE_CLONE_TEXT,
  },
];

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function resolveHost() {
  return readArg('--host') || String(process.env.NIMI_LIVE_AUDIO_FIXTURE_HOST || '').trim() || DEFAULT_HOST;
}

function resolvePort() {
  const raw = readArg('--port') || String(process.env.NIMI_LIVE_AUDIO_FIXTURE_PORT || '').trim() || String(DEFAULT_PORT);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`LIVE_AUDIO_FIXTURE_PORT_INVALID:${raw}`);
  }
  return value;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function runTool(command, args, failureCode) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`${failureCode}:${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${failureCode}:${String(result.stderr || result.stdout || 'unknown error').trim()}`);
  }
}

function ensureTool(command, failureCode) {
  const result = spawnSync('which', [command], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${failureCode}:${command}`);
  }
}

function ensureSpeechFixture(entry) {
  const outputPath = path.join(OUTPUT_DIR, entry.fileName);
  if (existsSync(outputPath)) {
    const size = statSync(outputPath).size;
    if (size > 0) {
      return outputPath;
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const intermediatePath = outputPath.replace(/\.wav$/i, '.aiff');
  rmSync(intermediatePath, { force: true });

  runTool(
    'say',
    ['-v', entry.voice, '-r', entry.rate, '-o', intermediatePath, entry.text],
    'LIVE_AUDIO_FIXTURE_SAY_FAILED',
  );
  runTool(
    'ffmpeg',
    ['-y', '-i', intermediatePath, '-ar', '16000', '-ac', '1', outputPath],
    'LIVE_AUDIO_FIXTURE_FFMPEG_FAILED',
  );
  rmSync(intermediatePath, { force: true });
  return outputPath;
}

function prepareFixtures() {
  ensureTool('say', 'LIVE_AUDIO_FIXTURE_SAY_MISSING');
  ensureTool('ffmpeg', 'LIVE_AUDIO_FIXTURE_FFMPEG_MISSING');
  return new Map(FIXTURES.map((entry) => [entry.pathName, ensureSpeechFixture(entry)]));
}

function writeTextResponse(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  response.end(body);
}

function startServer(host, port, fixtureFiles) {
  const baseURL = `http://${host}:${port}`;
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', `${baseURL}/`);

    if (requestUrl.pathname === '/health') {
      writeTextResponse(response, 200, JSON.stringify({ ok: true, baseURL }, null, 2), 'application/json; charset=utf-8');
      return;
    }

    const filePath = fixtureFiles.get(requestUrl.pathname);
    if (!filePath) {
      writeTextResponse(response, 404, 'not found');
      return;
    }

    response.writeHead(200, {
      'content-type': 'audio/wav',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'content-length': String(statSync(filePath).size),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, host, () => {
    printFixtureExports(buildFixtureExportPayload(host, port, fixtureFiles));
  });
}

function buildFixtureExportPayload(host, port, fixtureFiles) {
  const baseURL = `http://${host}:${port}`;
  const sttPath = fixtureFiles.get(FIXTURES[0].pathName) || '';
  const voiceClonePath = fixtureFiles.get(FIXTURES[1].pathName) || '';
  const sttURI = `${baseURL}${FIXTURES[0].pathName}`;
  const voiceCloneURI = `${baseURL}${FIXTURES[1].pathName}`;
  return {
    baseURL,
    sttPath,
    voiceClonePath,
    sttURI,
    voiceCloneURI,
    env: {
      NIMI_LIVE_STT_AUDIO_PATH: sttPath,
      NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH: voiceClonePath,
      NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_PATH: voiceClonePath,
      NIMI_LIVE_STT_AUDIO_URI: sttURI,
      NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI: voiceCloneURI,
      NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_URI: voiceCloneURI,
      NIMI_LIVE_DASHSCOPE_STT_MODEL_ID: 'qwen3-asr-flash-2026-02-10',
      NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID: 'qwen3-tts-vc',
      NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID: 'qwen3-tts-vc-2026-01-22',
    },
  };
}

function printFixtureExports(payload) {
  process.stdout.write([
    `live audio fixtures listening on ${payload.baseURL}`,
    `export NIMI_LIVE_STT_AUDIO_PATH=${payload.env.NIMI_LIVE_STT_AUDIO_PATH}`,
    `export NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH=${payload.env.NIMI_LIVE_VOICE_REFERENCE_AUDIO_PATH}`,
    `export NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_PATH=${payload.env.NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_PATH}`,
    `export NIMI_LIVE_STT_AUDIO_URI=${payload.env.NIMI_LIVE_STT_AUDIO_URI}`,
    `export NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI=${payload.env.NIMI_LIVE_VOICE_REFERENCE_AUDIO_URI}`,
    `export NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_URI=${payload.env.NIMI_LIVE_DASHSCOPE_VOICE_REFERENCE_AUDIO_URI}`,
    `export NIMI_LIVE_DASHSCOPE_STT_MODEL_ID=${payload.env.NIMI_LIVE_DASHSCOPE_STT_MODEL_ID}`,
    `export NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID=${payload.env.NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID}`,
    `export NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID=${payload.env.NIMI_LIVE_DASHSCOPE_VOICE_CLONE_MODEL_ID_TARGET_MODEL_ID}`,
    '',
  ].join('\n'));
}

function main() {
  const host = resolveHost();
  const port = resolvePort();
  const fixtureFiles = prepareFixtures();
  const payload = buildFixtureExportPayload(host, port, fixtureFiles);
  if (hasFlag('--prepare-only')) {
    if (hasFlag('--json')) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    printFixtureExports(payload);
    return;
  }
  startServer(host, port, fixtureFiles);
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`${detail}\n`);
  process.exit(1);
}
