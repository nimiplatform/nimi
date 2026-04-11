import { buildMergedEnv } from '../../../../scripts/lib/live-env.mjs';
import { Runtime } from '../../../../sdk/src/runtime/index.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  splitWaveIntoSegments,
} from './bilibili-food-video-probe-audio.mts';
import {
  type CommentClue,
  type CommentScreeningRecord,
  type ReplyApiItem,
  flattenReplies,
  screenCommentsForExtraction,
  filterCommentCluesForExtraction,
  mergeCommentCluesIntoExtraction,
} from './bilibili-food-video-comment.mts';
import {
  containsLikelyTraditionalChinese,
  extractJsonObject,
  normalizeExtractionJsonToSimplified,
  buildCommentCrossCheckPrompt,
  buildFoodExtractionPrompt,
  resolveConfiguredSttTarget,
  resolveConfiguredTextTarget,
  resolveSttModel,
  resolveTextModel,
  computeExtractionCoverage,
  buildTranscriptionSegments,
} from './bilibili-food-video-extraction.mts';

export type { CommentClue, CommentScreeningRecord, ReplyApiItem };
export { screenCommentsForExtraction, filterCommentCluesForExtraction, mergeCommentCluesIntoExtraction };
export { containsLikelyTraditionalChinese, buildCommentCrossCheckPrompt, buildFoodExtractionPrompt };
export {
  resolveConfiguredSttTarget,
  resolveConfiguredTextTarget,
  resolveSttModel,
  resolveTextModel,
  computeExtractionCoverage,
  buildTranscriptionSegments,
};

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
  selectedTextModel: string;
  rawCommentCount: number;
  commentClues: CommentClue[];
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

type PlayInfoAudioTrack = { baseUrl?: string; base_url?: string; backupUrl?: string[]; backup_url?: string[]; bandwidth?: number; id?: number };
type VideoApiResponse = { code?: number; data?: { bvid?: string; aid?: number; cid?: number; title?: string; duration?: number; desc?: string; owner?: { mid?: number; name?: string } } };
type TagApiResponse = { code?: number; data?: Array<{ tag_name?: string }> };
type PlayUrlApiResponse = { code?: number; message?: string; data?: { dash?: { audio?: PlayInfoAudioTrack[] }; durl?: Array<{ url?: string; backup_url?: string[] }> } };
type PlayerSubtitleTrack = { lan?: string; lan_doc?: string; subtitle_url?: string };
type PlayerV2ApiResponse = { code?: number; message?: string; data?: { subtitle?: { subtitles?: PlayerSubtitleTrack[] } } };
type SubtitlePayload = { body?: Array<{ content?: string }> };
type ReplyApiResponse = { code?: number; message?: string; data?: { replies?: ReplyApiItem[]; top?: ReplyApiItem | null; upper?: { top?: ReplyApiItem | null } } };

const DEFAULT_PROFILE_PATH = path.resolve(process.cwd(), 'config/live/dashscope-gold-path.env');
const DEFAULT_ENV_FILE_PATH = path.resolve(process.cwd(), '.env');
const DEFAULT_OUTPUT_ROOT = path.resolve(process.cwd(), '.tmp/bilibili-food-video-probe');
const LONG_AUDIO_THRESHOLD_SEC = 300;
const DEFAULT_APP_ID = 'nimi.video.food.probe';
const DEFAULT_SUBJECT_USER_ID = 'video-food-probe';
const DEFAULT_RUNTIME_GRPC_ADDR = '127.0.0.1:46371';
const PLATFORM_SUBTITLE_MODEL = 'platform/bilibili-subtitle';
const BILIBILI_PAGE_URL = 'https://www.bilibili.com/video/';
const BILIBILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/view';
const BILIBILI_TAG_API = 'https://api.bilibili.com/x/tag/archive/tags';
const BILIBILI_PLAYURL_API = 'https://api.bilibili.com/x/player/playurl';
const BILIBILI_PLAYER_V2_API = 'https://api.bilibili.com/x/player/v2';
const BILIBILI_REPLY_API = 'https://api.bilibili.com/x/v2/reply/main';
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

function replyApiHeaders(): HeadersInit {
  return {
    'accept': 'application/json',
    'referer': DEFAULT_REFERER,
    'user-agent': 'Mozilla/5.0',
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
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'unknown error');
    throw new Error(`${label} returned invalid json: ${detail}`, {
      cause: error,
    });
  }
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

  for (const track of rankedAudio) {
    const standardUrl = track.allUrls.find(isStandardCdn);
    if (standardUrl) {
      return standardUrl;
    }
  }
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

export async function resolveVideoMetadataByUrl(url: string): Promise<VideoMetadata> {
  return resolveVideoMetadata(extractBvid(url));
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

async function fetchPlayerV2(bvid: string, cid: string): Promise<PlayerV2ApiResponse> {
  const response = await fetchJson<PlayerV2ApiResponse>(
    `${BILIBILI_PLAYER_V2_API}?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
    { method: 'GET', headers: apiHeaders() },
    'bilibili player v2 api',
  );
  if (Number(response?.code || 0) !== 0 || !response.data) {
    throw new Error(`bilibili player v2 api returned code=${String(response?.code ?? '')}, message=${String(response?.message ?? '')}`);
  }
  return response;
}

export async function fetchPublicComments(aid: string): Promise<ReplyApiItem[]> {
  if (!String(aid || '').trim()) {
    return [];
  }
  const response = await fetchJson<ReplyApiResponse>(
    `${BILIBILI_REPLY_API}?oid=${encodeURIComponent(aid)}&type=1&mode=3&ps=20`,
    { method: 'GET', headers: replyApiHeaders() },
    'bilibili reply api',
  );
  if (Number(response?.code || 0) !== 0 || !response.data) {
    return [];
  }
  const rootReplies = Array.isArray(response.data.replies) ? response.data.replies : [];
  const upperTop = response.data.upper?.top ? [response.data.upper.top] : [];
  const top = response.data.top ? [response.data.top] : [];
  return flattenReplies([...upperTop, ...top, ...rootReplies])
    .filter((item) => String(item.content?.message || '').trim().length > 0);
}

function normalizeRemoteUrl(raw: string): string {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }
  try {
    return new URL(normalized, DEFAULT_REFERER).toString();
  } catch {
    return normalized;
  }
}

function chooseSubtitleTrack(tracks: PlayerSubtitleTrack[]): PlayerSubtitleTrack | null {
  const ranked = [...tracks]
    .map((track) => {
      const lan = String(track.lan || '').trim().toLowerCase();
      const doc = String(track.lan_doc || '').trim().toLowerCase();
      let score = 0;
      if (lan.startsWith('zh') || doc.includes('中文')) {
        score += 10;
      }
      if (lan.includes('cn') || lan.includes('hans') || doc.includes('简体')) {
        score += 10;
      }
      if (doc.includes('ai') || doc.includes('自动')) {
        score += 1;
      }
      return {
        track,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);
  for (const entry of ranked) {
    if (String(entry.track.subtitle_url || '').trim()) {
      return entry.track;
    }
  }
  return null;
}

function buildTranscriptFromSubtitlePayload(payload: SubtitlePayload): string {
  const rows = Array.isArray(payload.body) ? payload.body : [];
  return rows
    .map((row) => String(row.content || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function fetchSubtitleTranscript(metadata: VideoMetadata): Promise<string> {
  const playerV2 = await fetchPlayerV2(metadata.bvid, metadata.cid);
  const subtitles = Array.isArray(playerV2.data?.subtitle?.subtitles)
    ? playerV2.data?.subtitle?.subtitles || []
    : [];
  const track = chooseSubtitleTrack(subtitles);
  if (!track) {
    return '';
  }
  const subtitleUrl = normalizeRemoteUrl(String(track.subtitle_url || ''));
  if (!subtitleUrl) {
    return '';
  }
  const payload = await fetchJson<SubtitlePayload>(
    subtitleUrl,
    { method: 'GET', headers: cdnHeaders() },
    'bilibili subtitle payload',
  );
  return buildTranscriptFromSubtitlePayload(payload);
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

function inferAudioMimeType(url: string): string {
  if (/\.m4s(?:\?|$)/u.test(url) || /\.m4a(?:\?|$)/u.test(url)) {
    return 'audio/mp4';
  }
  if (/\.mp3(?:\?|$)/u.test(url)) {
    return 'audio/mpeg';
  }
  return '';
}

function resolveRuntimeGrpcAddr(mergedEnv: Record<string, string>): string {
  const explicit = String(mergedEnv.NIMI_RUNTIME_GRPC_ADDR || '').trim();
  if (explicit) return explicit;
  const configPath = String(mergedEnv.NIMI_RUNTIME_CONFIG_PATH || '').trim();
  const resolved = configPath
    ? (configPath.startsWith('~/') ? path.join(os.homedir(), configPath.slice(2)) : configPath)
    : path.join(os.homedir(), '.nimi', 'config.json');
  try {
    const config = JSON.parse(readFileSync(resolved, 'utf8')) as { grpcAddr?: unknown };
    const addr = String(config.grpcAddr || '').trim();
    if (addr) return addr;
  } catch { /* ignore */ }
  return DEFAULT_RUNTIME_GRPC_ADDR;
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
  const extractionJsonPath = path.join(outputDir, 'extraction.json');

  writeFileSync(metadataJson, `${JSON.stringify({
    metadata: input.metadata,
    audioSourceUrl: input.audioSourceUrl,
    extractionCoverage: input.extractionCoverage,
  }, null, 2)}\n`, 'utf8');
  writeFileSync(transcriptText, input.transcript, 'utf8');
  writeFileSync(extractionRawText, input.extractionRaw, 'utf8');
  writeFileSync(extractionJsonPath, `${JSON.stringify(input.extractionJson || {}, null, 2)}\n`, 'utf8');

  return {
    outputDir,
    metadataJson,
    transcriptText,
    extractionRawText,
    extractionJson: extractionJsonPath,
  };
}

async function transcribeAndExtract(input: {
  metadata: VideoMetadata;
  audioSourceUrl: string;
  mergedEnv: Record<string, string>;
}): Promise<Pick<FoodProbeResult, 'selectedSttModel' | 'selectedTextModel' | 'rawCommentCount' | 'commentClues' | 'extractionCoverage' | 'transcript' | 'extractionRaw' | 'extractionJson'>> {
  const runtimeGrpcAddr = resolveRuntimeGrpcAddr(input.mergedEnv);
  const textTarget = resolveConfiguredTextTarget({
    mergedEnv: input.mergedEnv,
  });
  const selectedTextModel = textTarget.model;

  const runtime = new Runtime({
    appId: DEFAULT_APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: runtimeGrpcAddr,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'video-food-probe',
    },
    subjectContext: {
      subjectUserId: DEFAULT_SUBJECT_USER_ID,
    },
  });

  const subtitleTranscript = await fetchSubtitleTranscript(input.metadata).catch(() => '');
  let selectedSttModel = PLATFORM_SUBTITLE_MODEL;
  let extractionCoverage: FoodProbeResult['extractionCoverage'] = {
    state: subtitleTranscript ? 'full' : 'leading_segments_only',
    processedSegmentCount: subtitleTranscript ? 1 : 0,
    processedDurationSec: subtitleTranscript ? Number(input.metadata.durationSec || 0) : 0,
    totalDurationSec: Number(input.metadata.durationSec || 0),
  };
  let transcript = subtitleTranscript.trim();

  if (!transcript) {
    const sttTarget = resolveConfiguredSttTarget({
      durationSec: input.metadata.durationSec,
      mergedEnv: input.mergedEnv,
    });
    const sttModel = sttTarget.model;
    selectedSttModel = sttModel;
    try {
      const transcribed = await runtime.media.stt.transcribe({
        model: sttModel,
        audio: {
          kind: 'url',
          url: input.audioSourceUrl,
        },
        mimeType: inferAudioMimeType(input.audioSourceUrl) || undefined,
        language: 'auto',
        route: sttTarget.route,
        ...(sttTarget.connectorId ? { connectorId: sttTarget.connectorId } : {}),
        timeoutMs: 240_000,
      });
      transcript = String(transcribed.text || '').trim();
      extractionCoverage = {
        state: 'full',
        processedSegmentCount: 1,
        processedDurationSec: Number(input.metadata.durationSec || 0),
        totalDurationSec: Number(input.metadata.durationSec || 0),
      };
    } catch {
      const audioTrack = await downloadAudioTrack(input.audioSourceUrl);
      const segments = buildTranscriptionSegments({
        shouldSegment: Number(input.metadata.durationSec || 0) > LONG_AUDIO_THRESHOLD_SEC,
        durationSec: input.metadata.durationSec,
        audioBytes: audioTrack.bytes,
        audioMimeType: audioTrack.mimeType,
      });
      const processedDurationSec = Math.min(
        Number(input.metadata.durationSec || 0),
        Math.max(0, ...segments.map((segment) => Number(segment.endSec || 0))),
      );
      extractionCoverage = {
        state: processedDurationSec < Number(input.metadata.durationSec || 0)
          ? 'leading_segments_only'
          : 'full',
        processedSegmentCount: segments.length,
        processedDurationSec,
        totalDurationSec: Number(input.metadata.durationSec || 0),
      };
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
          route: sttTarget.route,
          ...(sttTarget.connectorId ? { connectorId: sttTarget.connectorId } : {}),
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
    }
  }

  if (!transcript) {
    throw new Error('runtime returned empty transcript');
  }

  const rawComments = await fetchPublicComments(input.metadata.aid).catch(() => []);
  const crossCheckComments = filterCommentCluesForExtraction({
    extractionJson: null,
    comments: rawComments,
  });
  const extracted = await runtime.ai.text.generate({
    model: textTarget.model,
    input: buildFoodExtractionPrompt({
      metadata: input.metadata,
      transcript,
      commentClues: crossCheckComments,
    }),
    route: textTarget.route,
    ...(textTarget.connectorId ? { connectorId: textTarget.connectorId } : {}),
    timeoutMs: 240_000,
  });
  const extractionRaw = String(extracted.text || '').trim();
  const commentEnhancedJson = extractJsonObject(extractionRaw);
  const normalizedCommentEnhancedJson = await normalizeExtractionJsonToSimplified({
    runtime,
    textModel: textTarget.model,
    textRoute: textTarget.route,
    textConnectorId: textTarget.connectorId,
    extractionJson: commentEnhancedJson,
  });
  const commentClues = filterCommentCluesForExtraction({
    extractionJson: normalizedCommentEnhancedJson,
    comments: rawComments,
  });
  const extractionJson = mergeCommentCluesIntoExtraction({
    extractionJson: normalizedCommentEnhancedJson,
    commentClues,
  });

  return {
    selectedSttModel,
    selectedTextModel,
    rawCommentCount: rawComments.length,
    commentClues,
    extractionCoverage,
    transcript,
    extractionRaw,
    extractionJson,
  };
}

export { splitWaveIntoSegments };

export async function runBilibiliFoodVideoProbe(args: ProbeArgs): Promise<FoodProbeResult> {
  const bvid = extractBvid(args.url);
  const metadata = await resolveVideoMetadata(bvid);
  const playUrlResponse = await fetchPlayUrl(metadata.bvid, metadata.cid);
  const audioSourceUrl = chooseBestAudioUrl(playUrlResponse);
  const extractionCoverage = computeExtractionCoverage(metadata.durationSec);

  if (args.resolveOnly) {
    const mergedEnv = buildMergedEnv({
      baseEnv: process.env,
      filePaths: [args.profilePath, args.envFilePath],
    }) as Record<string, string>;
    const selectedSttModel = resolveConfiguredSttTarget({
      durationSec: metadata.durationSec,
      mergedEnv,
    }).model;
    const selectedTextModel = resolveConfiguredTextTarget({
      mergedEnv,
    }).model;
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
      selectedTextModel,
      rawCommentCount: 0,
      commentClues: [],
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

  const result = await transcribeAndExtract({
    metadata,
    audioSourceUrl,
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
    selectedTextModel: result.selectedTextModel,
    rawCommentCount: result.rawCommentCount,
    commentClues: result.commentClues,
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
