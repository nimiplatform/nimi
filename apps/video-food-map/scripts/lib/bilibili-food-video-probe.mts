import { buildMergedEnv } from '../../../../scripts/lib/live-env.mjs';
import { withRuntimeDaemon } from '../../../../sdk/test/runtime/contract/helpers/runtime-daemon.ts';
import { Runtime } from '../../../../sdk/src/runtime/index.ts';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type ProbeArgs = {
  url: string;
  cookie: string;
  profilePath: string;
  envFilePath: string;
  resolveOnly: boolean;
};

export type VideoMetadata = {
  bvid: string;
  aid: string;
  cid: string;
  title: string;
  ownerName: string;
  durationSec: number;
  description: string;
  tags: string[];
  canonicalUrl: string;
};

export type FoodProbeResult = {
  metadata: VideoMetadata;
  audioSourceUrl: string;
  selectedSttModel: string;
  selectedAudioMode: 'url' | 'bytes';
  transcript: string;
  extractionRaw: string;
  extractionJson: Record<string, unknown> | null;
  outputDir: string;
  savedFiles: {
    metadataJson: string;
    transcriptText: string;
    extractionRawText: string;
    extractionJson: string;
  };
};

type PlayInfoAudioTrack = {
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  id?: number;
};

type VideoApiResponse = {
  code?: number;
  data?: {
    bvid?: string;
    aid?: number;
    cid?: number;
    title?: string;
    duration?: number;
    desc?: string;
    owner?: {
      name?: string;
    };
  };
};

type TagApiResponse = {
  code?: number;
  data?: Array<{
    tag_name?: string;
  }>;
};

type PlayInfoPayload = {
  code?: number;
  data?: {
    dash?: {
      audio?: PlayInfoAudioTrack[];
    };
    durl?: Array<{
      url?: string;
      backup_url?: string[];
    }>;
  };
};

const DEFAULT_PROFILE_PATH = path.resolve(process.cwd(), 'dev/config/dashscope-gold-path.env');
const DEFAULT_ENV_FILE_PATH = path.resolve(process.cwd(), '.env');
const DEFAULT_OUTPUT_ROOT = path.resolve(process.cwd(), 'tmp/bilibili-food-video-probe');
const DEFAULT_SHORT_AUDIO_STT_MODEL = 'qwen3-asr-flash';
const LONG_AUDIO_THRESHOLD_SEC = 300;
const DEFAULT_SEGMENT_DURATION_SEC = 240;
const DEFAULT_MAX_SEGMENTS = 3;
const DEFAULT_APP_ID = 'nimi.video.food.probe';
const DEFAULT_SUBJECT_USER_ID = 'video-food-probe';
const BILIBILI_PAGE_URL = 'https://www.bilibili.com/video/';
const BILIBILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/view';
const BILIBILI_TAG_API = 'https://api.bilibili.com/x/tag/archive/tags';

function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function normalizeCookie(value: string): string {
  return String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ');
}

function requireArg(name: string, value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function coerceCloudModelId(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('cloud/') || normalized.includes('/')) {
    return normalized;
  }
  return `cloud/${normalized}`;
}

function toAbsolutePath(value: string, fallbackPath: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallbackPath;
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.resolve(process.cwd(), normalized);
}

function defaultHeaders(cookie: string): HeadersInit {
  return {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cookie': cookie,
    'referer': 'https://www.bilibili.com/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  };
}

export function extractBvid(input: string): string {
  const normalized = String(input || '').trim();
  if (!normalized) {
    throw new Error('video url or bvid is required');
  }
  const directMatch = normalized.match(/\b(BV[0-9A-Za-z]+)\b/u);
  if (directMatch?.[1]) {
    return directMatch[1];
  }
  throw new Error(`unable to extract BVID from input: ${normalized}`);
}

export function extractInlineJson(html: string, prefix: string): unknown {
  const marker = `${prefix}=`;
  const start = String(html || '').indexOf(marker);
  if (start < 0) {
    throw new Error(`missing inline json marker: ${prefix}`);
  }
  let index = start + marker.length;
  while (index < html.length && /\s/u.test(html[index] || '')) {
    index += 1;
  }
  if (html[index] !== '{') {
    throw new Error(`inline json marker ${prefix} is not followed by an object`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let cursor = index; cursor < html.length; cursor += 1) {
    const char = html[cursor] || '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return JSON.parse(html.slice(index, cursor + 1));
    }
  }

  throw new Error(`unterminated inline json for marker: ${prefix}`);
}

function parseJsonResponse<T>(payload: string, label: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    throw new Error(`${label} returned invalid json: ${error instanceof Error ? error.message : String(error || 'unknown error')}`);
  }
}

async function fetchText(url: string, init: RequestInit, label: string): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${label} failed: status=${response.status}`);
  }
  return await response.text();
}

async function fetchBytes(url: string, init: RequestInit, label: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${label} failed: status=${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (!bytes.length) {
    throw new Error(`${label} returned empty payload`);
  }
  return {
    bytes,
    mimeType: String(response.headers.get('content-type') || '').trim(),
  };
}

async function fetchJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const payload = await fetchText(url, init, label);
  return parseJsonResponse<T>(payload, label);
}

function assertBilibiliPageAvailable(html: string): void {
  if (/<title>验证码_哔哩哔哩<\/title>/u.test(html)) {
    throw new Error('bilibili blocked page fetch with captcha; refresh the login cookie and retry');
  }
}

function chooseBestAudioUrl(playInfo: PlayInfoPayload): string {
  const audioTracks = Array.isArray(playInfo?.data?.dash?.audio)
    ? playInfo.data?.dash?.audio || []
    : [];
  const rankedAudio = [...audioTracks]
    .map((track) => ({
      url: String(track.baseUrl || track.base_url || '').trim(),
      backupUrl: Array.isArray(track.backupUrl)
        ? track.backupUrl
        : Array.isArray(track.backup_url)
          ? track.backup_url
          : [],
      bandwidth: Number(track.bandwidth || 0),
      id: Number(track.id || 0),
    }))
    .sort((left, right) => {
      if (right.bandwidth !== left.bandwidth) {
        return right.bandwidth - left.bandwidth;
      }
      return right.id - left.id;
    });
  for (const track of rankedAudio) {
    if (track.url) {
      return track.url;
    }
    const backup = track.backupUrl.find((item) => String(item || '').trim());
    if (backup) {
      return backup;
    }
  }

  const durl = Array.isArray(playInfo?.data?.durl) ? playInfo.data?.durl || [] : [];
  for (const entry of durl) {
    const url = String(entry?.url || '').trim();
    if (url) {
      return url;
    }
    const backup = Array.isArray(entry?.backup_url)
      ? entry.backup_url.find((item) => String(item || '').trim())
      : '';
    if (backup) {
      return backup;
    }
  }

  throw new Error('unable to find audio source in bilibili playinfo');
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return null;
  }
  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidates = fencedMatch?.[1]
    ? [fencedMatch[1], normalized]
    : [normalized];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function ensureOutputDir(bvid: string): string {
  const outputDir = path.join(DEFAULT_OUTPUT_ROOT, bvid);
  mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function saveProbeArtifacts(input: {
  metadata: VideoMetadata;
  audioSourceUrl: string;
  transcript: string;
  extractionRaw: string;
  extractionJson: Record<string, unknown> | null;
}): FoodProbeResult['savedFiles'] & { outputDir: string } {
  const outputDir = ensureOutputDir(input.metadata.bvid);
  const metadataJson = path.join(outputDir, 'metadata.json');
  const transcriptText = path.join(outputDir, 'transcript.txt');
  const extractionRawText = path.join(outputDir, 'extraction-raw.txt');
  const extractionJson = path.join(outputDir, 'extraction.json');

  writeFileSync(metadataJson, `${JSON.stringify({
    metadata: input.metadata,
    audioSourceUrl: input.audioSourceUrl,
  }, null, 2)}\n`, 'utf8');
  writeFileSync(transcriptText, input.transcript, 'utf8');
  writeFileSync(extractionRawText, input.extractionRaw, 'utf8');
  writeFileSync(extractionJson, `${JSON.stringify(input.extractionJson || {}, null, 2)}\n`, 'utf8');

  return {
    outputDir,
    metadataJson,
    transcriptText,
    extractionRawText,
    extractionJson,
  };
}

function buildFoodExtractionPrompt(input: {
  metadata: VideoMetadata;
  transcript: string;
}): string {
  const metadataBlock = [
    `标题：${input.metadata.title}`,
    `作者：${input.metadata.ownerName}`,
    `简介：${input.metadata.description || '-'}`,
    `标签：${input.metadata.tags.join('、') || '-'}`,
  ].join('\n');

  return [
    '你是一个严格的信息提取助手，只能根据给定内容提取，不允许猜测。',
    '任务：从一条美食视频的转写里提取被明确推荐的店和菜。',
    '输出必须是 JSON 对象，不要输出任何额外解释。',
    'JSON 结构：',
    '{',
    '  "video_summary": "一句话总结这条视频主要在吃什么",',
    '  "venues": [',
    '    {',
    '      "venue_name": "店名，拿不准就写空字符串",',
    '      "recommended_dishes": ["明确推荐的菜"],',
    '      "evidence": ["直接支持推荐判断的原句"],',
    '      "polarity": "positive|mixed|uncertain|negative",',
    '      "confidence": "high|medium|low",',
    '      "needs_review": true',
    '    }',
    '  ],',
    '  "uncertain_points": ["拿不准的点"]',
    '}',
    '规则：',
    '1. 只收明确推荐的菜，不收只是出现过的菜。',
    '2. 只要店名、推荐菜、证据三者缺一，就把 needs_review 设为 true。',
    '3. 没有把握时，不要编造店名或菜名。',
    '',
    '视频元信息：',
    metadataBlock,
    '',
    '转写内容：',
    input.transcript,
  ].join('\n');
}

async function resolveVideoMetadata(bvid: string): Promise<VideoMetadata> {
  const view = await fetchJson<VideoApiResponse>(
    `${BILIBILI_VIEW_API}?bvid=${encodeURIComponent(bvid)}`,
    {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'user-agent': defaultHeaders('')['user-agent'] || '',
      },
    },
    'bilibili view api',
  );
  if (Number(view?.code || 0) !== 0 || !view.data) {
    throw new Error(`bilibili view api returned code=${String(view?.code ?? '')}`);
  }

  const tagsResponse = await fetchJson<TagApiResponse>(
    `${BILIBILI_TAG_API}?bvid=${encodeURIComponent(bvid)}`,
    {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'user-agent': defaultHeaders('')['user-agent'] || '',
      },
    },
    'bilibili tag api',
  );
  const tags = Array.isArray(tagsResponse?.data)
    ? tagsResponse.data
      .map((item) => String(item?.tag_name || '').trim())
      .filter(Boolean)
    : [];

  return {
    bvid: String(view.data?.bvid || bvid).trim(),
    aid: String(view.data?.aid || '').trim(),
    cid: String(view.data?.cid || '').trim(),
    title: String(view.data?.title || '').trim(),
    ownerName: String(view.data?.owner?.name || '').trim(),
    durationSec: Number(view.data?.duration || 0),
    description: String(view.data?.desc || '').trim(),
    tags,
    canonicalUrl: `${BILIBILI_PAGE_URL}${String(view.data?.bvid || bvid).trim()}/`,
  };
}

async function fetchPlayInfoHtml(url: string, cookie: string): Promise<string> {
  const html = await fetchText(url, {
    method: 'GET',
    headers: defaultHeaders(cookie),
  }, 'bilibili video page');
  assertBilibiliPageAvailable(html);
  return html;
}

async function downloadAudioTrack(url: string, cookie: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetchBytes(url, {
    method: 'GET',
    headers: defaultHeaders(cookie),
  }, 'bilibili audio track');
  if (response.mimeType) {
    return response;
  }
  if (/\.m4s(?:\?|$)/u.test(url) || /\.m4a(?:\?|$)/u.test(url)) {
    return { ...response, mimeType: 'audio/mp4' };
  }
  if (/\.mp3(?:\?|$)/u.test(url)) {
    return { ...response, mimeType: 'audio/mpeg' };
  }
  return response;
}

function inferAudioMimeTypeFromUrl(url: string): string {
  const normalized = String(url || '').trim().toLowerCase();
  if (normalized.includes('.m4s') || normalized.includes('.m4a')) {
    return 'audio/mp4';
  }
  if (normalized.includes('.mp3')) {
    return 'audio/mpeg';
  }
  if (normalized.includes('.wav')) {
    return 'audio/wav';
  }
  if (normalized.includes('.ogg')) {
    return 'audio/ogg';
  }
  return 'audio/mp4';
}

function requireEnvValue(env: Record<string, string>, key: string): string {
  const value = String(env[key] || '').trim();
  if (!value) {
    throw new Error(`missing required env: ${key}`);
  }
  return value;
}

export function resolveSttModel(input: {
  durationSec: number;
  mergedEnv: Record<string, string>;
}): string {
  const durationSec = Number(input.durationSec || 0);
  const preferLongAudio = Number.isFinite(durationSec) && durationSec > LONG_AUDIO_THRESHOLD_SEC;
  const standardModel = String(input.mergedEnv.NIMI_LIVE_DASHSCOPE_STT_MODEL_ID || '').trim();
  if (preferLongAudio) {
    const explicitLongAudio = String(
      input.mergedEnv.NIMI_LIVE_DASHSCOPE_STT_FILETRANS_MODEL_ID
      || input.mergedEnv.NIMI_LIVE_DASHSCOPE_LONG_AUDIO_STT_MODEL_ID
      || '',
    ).trim();
    if (explicitLongAudio) {
      return coerceCloudModelId(explicitLongAudio);
    }
    if (standardModel) {
      return coerceCloudModelId(standardModel);
    }
    return coerceCloudModelId(DEFAULT_SHORT_AUDIO_STT_MODEL);
  }

  if (standardModel) {
    return coerceCloudModelId(standardModel);
  }
  return coerceCloudModelId(DEFAULT_SHORT_AUDIO_STT_MODEL);
}

export function resolveAudioMode(durationSec: number): 'url' | 'bytes' {
  const normalized = Number(durationSec || 0);
  if (Number.isFinite(normalized) && normalized > LONG_AUDIO_THRESHOLD_SEC) {
    return 'bytes';
  }
  return 'bytes';
}

type WavePcm16 = {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  blockAlign: number;
  dataStart: number;
  dataSize: number;
};

type AudioSegment = {
  index: number;
  startSec: number;
  endSec: number;
  bytes: Uint8Array;
  mimeType: string;
};

function parseWavePcm16(bytes: Uint8Array): WavePcm16 {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) {
    throw new Error('wav payload is too small');
  }
  if (Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF') {
    throw new Error('wav payload missing RIFF header');
  }
  if (Buffer.from(bytes.subarray(8, 12)).toString('ascii') !== 'WAVE') {
    throw new Error('wav payload missing WAVE signature');
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataStart = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii');
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    if (chunkDataStart + chunkSize > bytes.byteLength) {
      throw new Error(`wav chunk ${chunkId} exceeds payload size`);
    }
    if (chunkId === 'fmt ') {
      const audioFormat = view.getUint16(chunkDataStart, true);
      channelCount = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      blockAlign = view.getUint16(chunkDataStart + 12, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);
      if (audioFormat !== 1) {
        throw new Error(`unsupported wav format: ${audioFormat}`);
      }
    }
    if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channelCount || !bitsPerSample || !blockAlign || !dataStart || !dataSize) {
    throw new Error('wav payload missing required fmt/data chunks');
  }
  if (bitsPerSample !== 16) {
    throw new Error(`unsupported wav bit depth: ${bitsPerSample}`);
  }

  return {
    sampleRate,
    channelCount,
    bitsPerSample,
    blockAlign,
    dataStart,
    dataSize,
  };
}

function buildWavePcm16(input: {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  pcmData: Uint8Array;
}): Uint8Array {
  const header = Buffer.alloc(44);
  const byteRate = input.sampleRate * input.channelCount * (input.bitsPerSample / 8);
  const blockAlign = input.channelCount * (input.bitsPerSample / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + input.pcmData.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(input.channelCount, 22);
  header.writeUInt32LE(input.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(input.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(input.pcmData.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(input.pcmData)]));
}

export function splitWaveIntoSegments(input: {
  wavBytes: Uint8Array;
  segmentDurationSec: number;
  maxSegments: number;
}): AudioSegment[] {
  const parsed = parseWavePcm16(input.wavBytes);
  const framesPerSegment = Math.max(1, Math.floor(input.segmentDurationSec * parsed.sampleRate));
  const bytesPerSegment = framesPerSegment * parsed.blockAlign;
  const pcmData = input.wavBytes.subarray(parsed.dataStart, parsed.dataStart + parsed.dataSize);
  const segments: AudioSegment[] = [];
  for (
    let index = 0, startByte = 0;
    startByte < pcmData.byteLength && index < input.maxSegments;
    index += 1, startByte += bytesPerSegment
  ) {
    const endByte = Math.min(pcmData.byteLength, startByte + bytesPerSegment);
    const segmentData = pcmData.subarray(startByte, endByte);
    const startFrame = Math.floor(startByte / parsed.blockAlign);
    const endFrame = Math.floor(endByte / parsed.blockAlign);
    const segmentBytes = buildWavePcm16({
      sampleRate: parsed.sampleRate,
      channelCount: parsed.channelCount,
      bitsPerSample: parsed.bitsPerSample,
      pcmData: segmentData,
    });
    segments.push({
      index: index + 1,
      startSec: startFrame / parsed.sampleRate,
      endSec: endFrame / parsed.sampleRate,
      bytes: segmentBytes,
      mimeType: 'audio/wav',
    });
  }
  return segments;
}

function transcodeAudioToWavePcm16(input: {
  sourceBytes: Uint8Array;
  sourceFileName: string;
}): Uint8Array {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-bili-audio-'));
  const inputPath = path.join(tempDir, input.sourceFileName);
  const outputPath = path.join(tempDir, 'audio.wav');
  try {
    writeFileSync(inputPath, input.sourceBytes);
    execFileSync('afconvert', [
      inputPath,
      '-o',
      outputPath,
      '-f',
      'WAVE',
      '-d',
      'LEI16@16000',
      '-c',
      '1',
    ], {
      stdio: 'pipe',
    });
    return new Uint8Array(readFileSync(outputPath));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'unknown error');
    throw new Error(`failed to transcode bilibili audio to wav: ${detail}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildRuntimeEnv(input: {
  mergedEnv: Record<string, string>;
}): Record<string, string> {
  return {
    NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL: String(
      input.mergedEnv.NIMI_LIVE_DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ).trim(),
    NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: requireEnvValue(input.mergedEnv, 'NIMI_LIVE_DASHSCOPE_API_KEY'),
  };
}

async function transcribeAndExtract(input: {
  metadata: VideoMetadata;
  audioSourceUrl: string;
  audioBytes: Uint8Array;
  audioMimeType: string;
  mergedEnv: Record<string, string>;
}): Promise<Pick<FoodProbeResult, 'selectedSttModel' | 'selectedAudioMode' | 'transcript' | 'extractionRaw' | 'extractionJson'>> {
  const shouldSegment = Number(input.metadata.durationSec || 0) > LONG_AUDIO_THRESHOLD_SEC;
  const sttModel = resolveSttModel({
    durationSec: shouldSegment ? DEFAULT_SEGMENT_DURATION_SEC : input.metadata.durationSec,
    mergedEnv: input.mergedEnv,
  });
  const audioMode: 'bytes' = 'bytes';
  const textModel = coerceCloudModelId(requireEnvValue(input.mergedEnv, 'NIMI_LIVE_DASHSCOPE_MODEL_ID'));
  const runtimeEnv = buildRuntimeEnv({ mergedEnv: input.mergedEnv });
  const segments = shouldSegment
    ? splitWaveIntoSegments({
      wavBytes: transcodeAudioToWavePcm16({
        sourceBytes: input.audioBytes,
        sourceFileName: 'audio-source.m4s',
      }),
      segmentDurationSec: DEFAULT_SEGMENT_DURATION_SEC,
      maxSegments: DEFAULT_MAX_SEGMENTS,
    })
    : [{
      index: 1,
      startSec: 0,
      endSec: Number(input.metadata.durationSec || 0),
      bytes: input.audioBytes,
      mimeType: input.audioMimeType,
    }];

  let transcript = '';
  let extractionRaw = '';
  await withRuntimeDaemon({
    appId: DEFAULT_APP_ID,
    runtimeEnv,
    run: async ({ endpoint }) => {
      const runtime = new Runtime({
        appId: DEFAULT_APP_ID,
        transport: {
          type: 'node-grpc',
          endpoint,
        },
        defaults: {
          callerKind: 'desktop-core',
          callerId: 'video-food-probe',
        },
        subjectContext: {
          subjectUserId: DEFAULT_SUBJECT_USER_ID,
        },
      });

      const transcriptParts: string[] = [];
      for (const segment of segments) {
        const transcribed = await runtime.media.stt.transcribe({
          model: sttModel,
          audio: {
            kind: 'bytes',
            bytes: segment.bytes,
          },
          mimeType: segment.mimeType,
          language: 'yue',
          route: 'cloud',
          timeoutMs: 240_000,
        });
        const segmentText = String(transcribed.text || '').trim();
        if (!segmentText) {
          continue;
        }
        transcriptParts.push(
          `【片段${segment.index} ${Math.round(segment.startSec)}-${Math.round(segment.endSec)}秒】\n${segmentText}`,
        );
      }
      transcript = transcriptParts.join('\n\n').trim();
      if (!transcript) {
        throw new Error('runtime returned empty transcript');
      }

      const extracted = await runtime.ai.text.generate({
        model: textModel,
        input: buildFoodExtractionPrompt({
          metadata: input.metadata,
          transcript,
        }),
        route: 'cloud',
        timeoutMs: 240_000,
      });
      extractionRaw = String(extracted.text || '').trim();
    },
  });

  return {
    selectedSttModel: sttModel,
    selectedAudioMode: audioMode,
    transcript,
    extractionRaw,
    extractionJson: extractJsonObject(extractionRaw),
  };
}

export async function runBilibiliFoodVideoProbe(args: ProbeArgs): Promise<FoodProbeResult> {
  const bvid = extractBvid(args.url);
  const metadata = await resolveVideoMetadata(bvid);
  const html = await fetchPlayInfoHtml(metadata.canonicalUrl, args.cookie);
  const playInfo = extractInlineJson(html, 'window.__playinfo__') as PlayInfoPayload;
  const audioSourceUrl = chooseBestAudioUrl(playInfo);
  const selectedAudioMode = resolveAudioMode(metadata.durationSec);
  if (args.resolveOnly) {
    const selectedSttModel = resolveSttModel({
      durationSec: metadata.durationSec,
      mergedEnv: buildMergedEnv({
        baseEnv: process.env,
        filePaths: [args.profilePath, args.envFilePath],
      }) as Record<string, string>,
    });
    const saved = saveProbeArtifacts({
      metadata,
      audioSourceUrl,
      transcript: '',
      extractionRaw: '',
      extractionJson: null,
    });
    return {
      metadata,
      audioSourceUrl,
      selectedSttModel,
      selectedAudioMode,
      transcript: '',
      extractionRaw: '',
      extractionJson: null,
      outputDir: saved.outputDir,
      savedFiles: {
        metadataJson: saved.metadataJson,
        transcriptText: saved.transcriptText,
        extractionRawText: saved.extractionRawText,
        extractionJson: saved.extractionJson,
      },
    };
  }
  const mergedEnv = buildMergedEnv({
    baseEnv: process.env,
    filePaths: [args.profilePath, args.envFilePath],
  }) as Record<string, string>;
  const audioTrack = await downloadAudioTrack(audioSourceUrl, args.cookie);

  const result = await transcribeAndExtract({
    metadata,
    audioSourceUrl,
    audioBytes: audioTrack.bytes,
    audioMimeType: audioTrack.mimeType,
    mergedEnv,
  });
  const saved = saveProbeArtifacts({
    metadata,
    audioSourceUrl,
    transcript: result.transcript,
    extractionRaw: result.extractionRaw,
    extractionJson: result.extractionJson,
  });

  return {
    metadata,
    audioSourceUrl,
    selectedSttModel: result.selectedSttModel,
    selectedAudioMode: result.selectedAudioMode,
    transcript: result.transcript,
    extractionRaw: result.extractionRaw,
    extractionJson: result.extractionJson,
    outputDir: saved.outputDir,
    savedFiles: {
      metadataJson: saved.metadataJson,
      transcriptText: saved.transcriptText,
      extractionRawText: saved.extractionRawText,
      extractionJson: saved.extractionJson,
    },
  };
}

export function parseProbeArgs(): ProbeArgs {
  const url = requireArg('--url', readArg('--url'));
  const cookie = normalizeCookie(process.env.BILIBILI_COOKIE || readArg('--cookie'));
  if (!cookie) {
    throw new Error('BILIBILI_COOKIE or --cookie is required');
  }
  const profilePath = toAbsolutePath(readArg('--profile'), DEFAULT_PROFILE_PATH);
  const envFilePath = toAbsolutePath(readArg('--env-file'), DEFAULT_ENV_FILE_PATH);
  return {
    url,
    cookie,
    profilePath,
    envFilePath,
    resolveOnly: process.argv.includes('--resolve-only'),
  };
}
