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
  profilePath: string;
  envFilePath: string;
  resolveOnly: boolean;
};

export type VideoMetadata = {
  bvid: string;
  aid: string;
  cid: string;
  title: string;
  ownerMid: string;
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
  extractionCoverage: {
    state: 'full' | 'leading_segments_only';
    processedSegmentCount: number;
    processedDurationSec: number;
    totalDurationSec: number;
  };
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
      mid?: number;
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

type PlayUrlApiResponse = {
  code?: number;
  message?: string;
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
const DEFAULT_OUTPUT_ROOT = path.resolve(process.cwd(), '.tmp/bilibili-food-video-probe');
const DEFAULT_SHORT_AUDIO_STT_MODEL = 'qwen3-asr-flash';
const LONG_AUDIO_THRESHOLD_SEC = 300;
const DEFAULT_SEGMENT_DURATION_SEC = 240;
const DEFAULT_MAX_SEGMENTS = 3;
const DEFAULT_APP_ID = 'nimi.video.food.probe';
const DEFAULT_SUBJECT_USER_ID = 'video-food-probe';
const BILIBILI_PAGE_URL = 'https://www.bilibili.com/video/';
const BILIBILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/view';
const BILIBILI_TAG_API = 'https://api.bilibili.com/x/tag/archive/tags';
const BILIBILI_PLAYURL_API = 'https://api.bilibili.com/x/player/playurl';
const MCDN_HOST_PATTERN = /\.mcdn\.bilivideo\.cn/u;
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DEFAULT_REFERER = 'https://www.bilibili.com/';

function readArg(flag: string, argv: string[] = process.argv): string {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(argv[index + 1] || '').trim();
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

function apiHeaders(): HeadersInit {
  return {
    'accept': 'application/json',
    'referer': DEFAULT_REFERER,
    'user-agent': DEFAULT_UA,
  };
}

function cdnHeaders(): HeadersInit {
  return {
    'referer': DEFAULT_REFERER,
    'user-agent': DEFAULT_UA,
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

function isStandardCdn(url: string): boolean {
  return !MCDN_HOST_PATTERN.test(url);
}

function chooseBestAudioUrl(playInfo: PlayUrlApiResponse): string {
  const audioTracks = Array.isArray(playInfo?.data?.dash?.audio)
    ? playInfo.data?.dash?.audio || []
    : [];
  const rankedAudio = [...audioTracks]
    .map((track) => {
      const primaryUrl = String(track.baseUrl || track.base_url || '').trim();
      const backups = Array.isArray(track.backupUrl)
        ? track.backupUrl
        : Array.isArray(track.backup_url)
          ? track.backup_url
          : [];
      const allUrls = [primaryUrl, ...backups.map((u) => String(u || '').trim())].filter(Boolean);
      return {
        allUrls,
        bandwidth: Number(track.bandwidth || 0),
        id: Number(track.id || 0),
      };
    })
    .sort((left, right) => {
      if (right.bandwidth !== left.bandwidth) {
        return right.bandwidth - left.bandwidth;
      }
      return right.id - left.id;
    });

  // Prefer standard CDN over MCDN for cookieless reliability
  for (const track of rankedAudio) {
    const standardUrl = track.allUrls.find(isStandardCdn);
    if (standardUrl) {
      return standardUrl;
    }
  }
  // Fall back to any available URL
  for (const track of rankedAudio) {
    if (track.allUrls.length > 0) {
      return track.allUrls[0]!;
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

  throw new Error('unable to find audio source in bilibili playurl response');
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
  extractionCoverage: FoodProbeResult['extractionCoverage'];
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
    extractionCoverage: input.extractionCoverage,
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
    '      "address_text": "地址文本、商圈或地理线索，拿不准就写空字符串",',
    '      "recommended_dishes": ["明确推荐的菜"],',
    '      "cuisine_tags": ["菜系标签，没有就空数组"],',
    '      "flavor_tags": ["口味标签，没有就空数组"],',
    '      "evidence": ["直接支持推荐判断的原句"],',
    '      "recommendation_polarity": "positive|mixed|uncertain|negative",',
    '      "confidence": "high|medium|low",',
    '      "needs_review": true',
    '    }',
    '  ],',
    '  "uncertain_points": ["拿不准的点"]',
    '}',
    '规则：',
    '1. 只收明确推荐的菜，不收只是出现过的菜。',
    '2. 店名、地址、菜系、口味拿不准时可以留空，但不要编造。',
    '3. 只要店名、推荐菜、证据三者缺一，就把 needs_review 设为 true。',
    '4. 如果同一视频提到多家店，必须拆成多个 venue 对象。',
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
    { method: 'GET', headers: apiHeaders() },
    'bilibili view api',
  );
  if (Number(view?.code || 0) !== 0 || !view.data) {
    throw new Error(`bilibili view api returned code=${String(view?.code ?? '')}`);
  }

  const tagsResponse = await fetchJson<TagApiResponse>(
    `${BILIBILI_TAG_API}?bvid=${encodeURIComponent(bvid)}`,
    { method: 'GET', headers: apiHeaders() },
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
    ownerMid: String(view.data?.owner?.mid || '').trim(),
    ownerName: String(view.data?.owner?.name || '').trim(),
    durationSec: Number(view.data?.duration || 0),
    description: String(view.data?.desc || '').trim(),
    tags,
    canonicalUrl: `${BILIBILI_PAGE_URL}${String(view.data?.bvid || bvid).trim()}/`,
  };
}

async function fetchPlayUrl(bvid: string, cid: string): Promise<PlayUrlApiResponse> {
  const response = await fetchJson<PlayUrlApiResponse>(
    `${BILIBILI_PLAYURL_API}?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=16&fourk=1`,
    { method: 'GET', headers: apiHeaders() },
    'bilibili playurl api',
  );
  if (Number(response?.code || 0) !== 0 || !response.data) {
    throw new Error(`bilibili playurl api returned code=${String(response?.code ?? '')}, message=${String(response?.message ?? '')}`);
  }
  return response;
}

async function downloadAudioTrack(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetchBytes(url, {
    method: 'GET',
    headers: cdnHeaders(),
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

export function computeExtractionCoverage(durationSec: number): FoodProbeResult['extractionCoverage'] {
  const total = Number(durationSec || 0);
  const isLong = total > LONG_AUDIO_THRESHOLD_SEC;
  const segmentCount = isLong
    ? Math.min(DEFAULT_MAX_SEGMENTS, Math.ceil(total / DEFAULT_SEGMENT_DURATION_SEC))
    : 1;
  const processedDuration = isLong
    ? Math.min(total, DEFAULT_MAX_SEGMENTS * DEFAULT_SEGMENT_DURATION_SEC)
    : total;
  return {
    state: processedDuration < total ? 'leading_segments_only' : 'full',
    processedSegmentCount: segmentCount,
    processedDurationSec: processedDuration,
    totalDurationSec: total,
  };
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
    execFileSync('ffmpeg', [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-sample_fmt', 's16',
      '-f', 'wav',
      '-y',
      outputPath,
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
}): Promise<Pick<FoodProbeResult, 'selectedSttModel' | 'extractionCoverage' | 'transcript' | 'extractionRaw' | 'extractionJson'>> {
  const shouldSegment = Number(input.metadata.durationSec || 0) > LONG_AUDIO_THRESHOLD_SEC;
  const sttModel = resolveSttModel({
    durationSec: shouldSegment ? DEFAULT_SEGMENT_DURATION_SEC : input.metadata.durationSec,
    mergedEnv: input.mergedEnv,
  });
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
  const processedDurationSec = Math.min(
    Number(input.metadata.durationSec || 0),
    Math.max(0, ...segments.map((segment) => Number(segment.endSec || 0))),
  );
  const extractionCoverage: FoodProbeResult['extractionCoverage'] = {
    state: processedDurationSec < Number(input.metadata.durationSec || 0)
      ? 'leading_segments_only'
      : 'full',
    processedSegmentCount: segments.length,
    processedDurationSec,
    totalDurationSec: Number(input.metadata.durationSec || 0),
  };

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
          language: 'auto',
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
    extractionCoverage,
    transcript,
    extractionRaw,
    extractionJson: extractJsonObject(extractionRaw),
  };
}

export async function runBilibiliFoodVideoProbe(args: ProbeArgs): Promise<FoodProbeResult> {
  const bvid = extractBvid(args.url);
  const metadata = await resolveVideoMetadata(bvid);
  const playUrlResponse = await fetchPlayUrl(metadata.bvid, metadata.cid);
  const audioSourceUrl = chooseBestAudioUrl(playUrlResponse);
  const extractionCoverage = computeExtractionCoverage(metadata.durationSec);

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
      extractionCoverage,
      transcript: '',
      extractionRaw: '',
      extractionJson: null,
    });
    return {
      metadata,
      audioSourceUrl,
      selectedSttModel,
      extractionCoverage,
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
  const audioTrack = await downloadAudioTrack(audioSourceUrl);

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
    extractionCoverage: result.extractionCoverage,
    transcript: result.transcript,
    extractionRaw: result.extractionRaw,
    extractionJson: result.extractionJson,
  });

  return {
    metadata,
    audioSourceUrl,
    selectedSttModel: result.selectedSttModel,
    extractionCoverage: result.extractionCoverage,
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

export function parseProbeArgs(argv: string[] = process.argv): ProbeArgs {
  const url = requireArg('--url', readArg('--url', argv));
  const profilePath = toAbsolutePath(readArg('--profile', argv), DEFAULT_PROFILE_PATH);
  const envFilePath = toAbsolutePath(readArg('--env-file', argv), DEFAULT_ENV_FILE_PATH);
  return {
    url,
    profilePath,
    envFilePath,
    resolveOnly: argv.includes('--resolve-only'),
  };
}
