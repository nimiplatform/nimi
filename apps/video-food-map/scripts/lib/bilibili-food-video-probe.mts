import { buildMergedEnv } from '../../../../scripts/lib/live-env.mjs';
import { Runtime } from '../../../../sdk/src/runtime/index.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  type AudioSegment,
  splitWaveIntoSegments,
  transcodeAudioToWavePcm16,
} from './bilibili-food-video-probe-audio.mts';

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

type PlayerSubtitleTrack = {
  lan?: string;
  lan_doc?: string;
  subtitle_url?: string;
};

type PlayerV2ApiResponse = {
  code?: number;
  message?: string;
  data?: {
    subtitle?: {
      subtitles?: PlayerSubtitleTrack[];
    };
  };
};

type SubtitlePayload = {
  body?: Array<{
    content?: string;
  }>;
};

export type CommentClue = {
  commentId: string;
  authorName: string;
  message: string;
  likeCount: number;
  publishedAt: string;
  matchedVenueNames: string[];
  addressHint: string;
};

type ReplyApiMember = {
  uname?: string;
};

type ReplyApiContent = {
  message?: string;
};

export type ReplyApiItem = {
  rpid?: number | string;
  like?: number;
  ctime?: number;
  member?: ReplyApiMember;
  content?: ReplyApiContent;
  replies?: ReplyApiItem[];
};

type ReplyApiResponse = {
  code?: number;
  message?: string;
  data?: {
    replies?: ReplyApiItem[];
    top?: ReplyApiItem | null;
    upper?: {
      top?: ReplyApiItem | null;
    };
  };
};

const DEFAULT_PROFILE_PATH = path.resolve(process.cwd(), 'dev/config/dashscope-gold-path.env');
const DEFAULT_ENV_FILE_PATH = path.resolve(process.cwd(), '.env');
const DEFAULT_OUTPUT_ROOT = path.resolve(process.cwd(), '.tmp/bilibili-food-video-probe');
const DEFAULT_TEXT_MODEL = 'qwen-plus-latest';
const DEFAULT_SHORT_AUDIO_STT_MODEL = 'qwen3-asr-flash';
const LONG_AUDIO_THRESHOLD_SEC = 300;
const DEFAULT_SEGMENT_DURATION_SEC = 240;
const DEFAULT_MAX_SEGMENTS = 3;
const DEFAULT_APP_ID = 'nimi.video.food.probe';
const DEFAULT_SUBJECT_USER_ID = 'video-food-probe';
const DEFAULT_RUNTIME_GRPC_ADDR = '127.0.0.1:46371';
const DEFAULT_DIRECT_AUDIO_BYTES_LIMIT = 6 * 1024 * 1024;
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
const DEFAULT_MAX_COMMENT_CROSSCHECK = 10;

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

function parseJsonResponse<T>(payload: string, label: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'unknown error');
    throw new Error(`${label} returned invalid json: ${detail}`, {
      cause: error,
    });
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

function normalizeForCompare(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/gu, '');
}

function formatPublishedAt(timestampSec: number): string {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) {
    return '';
  }
  return new Date(timestampSec * 1000).toISOString();
}

function isSpecificAddressText(addressText: string): boolean {
  const normalized = String(addressText || '').trim();
  if (!normalized) {
    return false;
  }
  const vagueMarkers = ['附近', '旁边', '周边', '对面', '里面', '门口', '地铁', '公交', '商圈', '一带', '附近的'];
  if (vagueMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }
  if (/\d/u.test(normalized)) {
    return true;
  }
  return ['号', '路', '街', '巷', '弄', '大道', '道', '楼', '层', '栋', '室', '城', '广场']
    .some((marker) => normalized.includes(marker));
}

function isPreciseCommentAddressText(addressText: string): boolean {
  const normalized = String(addressText || '').trim();
  if (!normalized) {
    return false;
  }
  if (['附近', '隔壁', '周街', '周边', '旁边', '对面', '里面', '门口'].some((marker) => normalized.includes(marker))) {
    return false;
  }
  if (/(?:路|街|巷|弄|大道|道).*(?:\d|号|楼|层|栋|室)/u.test(normalized)) {
    return true;
  }
  if (/(?:市|区|县|镇|乡|村).*(?:路|街|巷|弄|大道|道|\d|号)/u.test(normalized)) {
    return true;
  }
  if (/(?:广场|商城|中心|商场).*(?:\d+楼|\d+层|[AB]\d)/u.test(normalized)) {
    return true;
  }
  return false;
}

function extractAddressHintFromComment(message: string): string {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }
  const patterns = [
    /(?:地址(?:是|在)?|就在|在)\s*([\u4e00-\u9fa5A-Za-z0-9\-]{2,32}(?:路|街|巷|弄|道|大道)[\u4e00-\u9fa5A-Za-z0-9\-]{0,20}(?:号|楼|层|栋|室)?)/u,
    /((?:[\u4e00-\u9fa5]{1,12}(?:省|市|区|县)){0,3}[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:路|街|巷|弄|道|大道)[\u4e00-\u9fa5A-Za-z0-9\-]{0,20}(?:号|楼|层|栋|室)?)/u,
    /((?:[\u4e00-\u9fa5]{1,16}(?:广场|商城|天地|中心|城|mall|MALL))(?:[\u4e00-\u9fa5A-Za-z0-9\-]{0,12}(?:[A-Z]?[0-9]+楼|[0-9]+层|[0-9]+楼|[AB]\d))?)/u,
  ];
  for (const pattern of patterns) {
    const matched = normalized.match(pattern)?.[1] || '';
    if (matched && isPreciseCommentAddressText(matched)) {
      return matched.trim();
    }
  }
  return '';
}

function flattenReplies(items: ReplyApiItem[], bucket: ReplyApiItem[] = []): ReplyApiItem[] {
  for (const item of items) {
    bucket.push(item);
    if (Array.isArray(item.replies) && item.replies.length > 0) {
      flattenReplies(item.replies, bucket);
    }
  }
  return bucket;
}

function readVenueNameCandidates(extractionJson: Record<string, unknown> | null): string[] {
  const venues = Array.isArray(extractionJson?.venues) ? extractionJson.venues : [];
  return venues
    .map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? String((entry as Record<string, unknown>).venue_name || '').trim() : ''))
    .filter(Boolean);
}

function extractVenueNameHintsFromComment(message: string): string[] {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return [];
  }
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:小食店|餐厅|农庄|酒店|酒楼|饭店|面馆|粉店|茶餐厅|烧腊店|烧鹅店|烧烤店|甜品店|咖啡店|大排档|食店|食府|茶档|排档))/gu;
  const matches = [...normalized.matchAll(pattern)]
    .map((entry) => String(entry[1] || '').trim())
    .filter(Boolean);
  return [...new Set(matches)];
}

function hasCrossCheckCue(message: string): boolean {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return false;
  }
  const markers = ['本期', '店名', '地址', '具体地址', '导航', '到店', '地图', '就在', '斜对面', '楼下', '附近'];
  return markers.some((marker) => normalized.includes(marker));
}

function buildCommentClue(input: {
  comment: ReplyApiItem;
  knownVenueNames: string[];
}): CommentClue | null {
  const message = String(input.comment.content?.message || '').replace(/\s+/gu, ' ').trim();
  if (!message) {
    return null;
  }
  const normalizedMessage = normalizeForCompare(message);
  const matchedKnownVenueNames = input.knownVenueNames.filter((venueName) =>
    normalizedMessage.includes(normalizeForCompare(venueName)),
  );
  const extractedVenueHints = extractVenueNameHintsFromComment(message);
  const matchedVenueNames = [...new Set([...matchedKnownVenueNames, ...extractedVenueHints])];
  const addressHint = extractAddressHintFromComment(message);
  const shouldKeep = matchedVenueNames.length > 0 || Boolean(addressHint) || hasCrossCheckCue(message);
  if (!shouldKeep) {
    return null;
  }
  return {
    commentId: String(input.comment.rpid || '').trim(),
    authorName: String(input.comment.member?.uname || '').trim(),
    message,
    likeCount: Number(input.comment.like || 0),
    publishedAt: formatPublishedAt(Number(input.comment.ctime || 0)),
    matchedVenueNames,
    addressHint,
  };
}

export function filterCommentCluesForExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  comments: ReplyApiItem[];
}): CommentClue[] {
  const clues = input.comments
    .map((comment) => buildCommentClue({
      comment,
      knownVenueNames: readVenueNameCandidates(input.extractionJson),
    }))
    .filter((item): item is CommentClue => Boolean(item));

  const deduped = new Map<string, CommentClue>();
  for (const clue of clues) {
    const key = normalizeForCompare(`${clue.matchedVenueNames.join('|')}|${clue.addressHint}|${clue.message}`);
    if (!deduped.has(key)) {
      deduped.set(key, clue);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const leftScore = (left.matchedVenueNames.length * 10) + (left.addressHint ? 6 : 0) + Math.min(left.likeCount, 20);
      const rightScore = (right.matchedVenueNames.length * 10) + (right.addressHint ? 6 : 0) + Math.min(right.likeCount, 20);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      if (right.likeCount !== left.likeCount) {
        return right.likeCount - left.likeCount;
      }
      return String(right.publishedAt).localeCompare(String(left.publishedAt));
    })
    .slice(0, DEFAULT_MAX_COMMENT_CROSSCHECK);
}

export function mergeCommentCluesIntoExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  commentClues: CommentClue[];
}): Record<string, unknown> | null {
  if (!input.extractionJson) {
    return input.commentClues.length > 0
      ? {
        video_summary: '',
        venues: [],
        uncertain_points: [],
        comment_clues: input.commentClues,
      }
      : null;
  }

  const cloned = JSON.parse(JSON.stringify(input.extractionJson)) as Record<string, unknown>;
  const venues = Array.isArray(cloned.venues) ? cloned.venues : [];
  const uncertainPoints = Array.isArray(cloned.uncertain_points)
    ? [...cloned.uncertain_points].map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  for (const entry of venues) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const venue = entry as Record<string, unknown>;
    const venueName = String(venue.venue_name || '').trim();
    const addressText = String(venue.address_text || '').trim();
    if (!venueName) {
      continue;
    }

    const matchedClues = input.commentClues.filter((clue) =>
      clue.matchedVenueNames.some((name) => normalizeForCompare(name) === normalizeForCompare(venueName))
      && clue.addressHint,
    );
    const distinctHints = [...new Set(matchedClues.map((clue) => clue.addressHint.trim()).filter(Boolean))];
    if (distinctHints.length === 1 && !isSpecificAddressText(addressText)) {
      venue.address_text = distinctHints[0]!;
      const evidence = Array.isArray(venue.evidence) ? [...venue.evidence] : [];
      const quoted = matchedClues[0]?.message ? `评论补充：${matchedClues[0].message}` : '';
      if (quoted && !evidence.includes(quoted)) {
        evidence.push(quoted);
      }
      venue.evidence = evidence;
    } else if (distinctHints.length > 1) {
      uncertainPoints.push(`评论区对“${venueName}”给出了多个不同地址线索，暂时保留待确认。`);
      venue.needs_review = true;
    }
  }

  cloned.uncertain_points = [...new Set(uncertainPoints)];
  cloned.comment_clues = input.commentClues;
  return cloned;
}

async function normalizeExtractionJsonToSimplified(input: {
  runtime: Runtime;
  textModel: string;
  extractionJson: Record<string, unknown> | null;
}): Promise<Record<string, unknown> | null> {
  if (!input.extractionJson) {
    return null;
  }

  const normalized = await input.runtime.ai.text.generate({
    model: input.textModel,
    input: [
      '把下面这个 JSON 里的中文内容统一改成简体中文。',
      '不要改键名、结构、英文值、数字、布尔值或数组层级。',
      '如果原文已经是简体，保持不变。',
      '只输出 JSON，不要输出解释。',
      '',
      JSON.stringify(input.extractionJson, null, 2),
    ].join('\n'),
    route: 'cloud',
    timeoutMs: 240_000,
  });
  return extractJsonObject(String(normalized.text || '').trim()) || input.extractionJson;
}

function buildCommentCrossCheckPrompt(input: {
  metadata: VideoMetadata;
  transcript: string;
  extractionJson: Record<string, unknown> | null;
  commentClues: CommentClue[];
}): string {
  const metadataBlock = [
    `标题：${input.metadata.title}`,
    `作者：${input.metadata.ownerName}`,
    `简介：${input.metadata.description || '-'}`,
    `标签：${input.metadata.tags.join('、') || '-'}`,
  ].join('\n');
  const commentBlock = input.commentClues.map((clue, index) => [
    `评论${index + 1}：`,
    `评论ID：${clue.commentId || '-'}`,
    `作者：${clue.authorName || '-'}`,
    `点赞：${clue.likeCount}`,
    `可能店名：${clue.matchedVenueNames.join('、') || '-'}`,
    `可能地址：${clue.addressHint || '-'}`,
    `内容：${clue.message}`,
  ].join('\n')).join('\n\n');

  return [
    '你是一个严格的信息核对助手，现在要用公开视频评论去补充第一轮视频提取结果。',
    '目标：结合视频转写、第一轮提取结果、评论线索，重新输出最终 JSON。',
    '允许评论补店名、地址和证据，但必须和视频内容互相对得上。',
    '如果评论只是一条孤证，或者和视频内容冲突，不要直接当成确认事实。',
    '如果评论提供了新店名，但菜品、地点或行程能和视频内容对应上，可以补进 venue_name。',
    '如果评论提供了更具体地址，而视频原来只有模糊区域，可以补进 address_text。',
    '如果评论之间互相冲突，或者和视频内容冲突，要保留 needs_review=true，并把冲突写进 uncertain_points。',
    'evidence 里可以加入“评论补充：...”这样的句子，保留原始线索。',
    '输出必须是 JSON 对象，不要输出任何解释。',
    '所有中文字段一律使用简体中文输出。',
    '保持 JSON 结构不变：video_summary / venues / uncertain_points。',
    '',
    '视频元信息：',
    metadataBlock,
    '',
    '第一轮提取结果：',
    JSON.stringify(input.extractionJson || {}, null, 2),
    '',
    '转写内容：',
    input.transcript,
    '',
    '评论线索：',
    commentBlock || '无',
  ].join('\n');
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
    '所有中文字段一律使用简体中文输出。',
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
    '5. 输出里的中文不要使用繁体字。',
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

export function resolveTextModel(input: {
  mergedEnv: Record<string, string>;
}): string {
  const configured = String(
    input.mergedEnv.NIMI_VIDEO_FOOD_MAP_TEXT_MODEL_ID
    || input.mergedEnv.NIMI_LIVE_DASHSCOPE_MODEL_ID
    || '',
  ).trim();
  if (configured) {
    return coerceCloudModelId(configured);
  }
  return coerceCloudModelId(DEFAULT_TEXT_MODEL);
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

function resolveRuntimeConfigPath(mergedEnv: Record<string, string>): string {
  const explicit = String(mergedEnv.NIMI_RUNTIME_CONFIG_PATH || '').trim();
  if (explicit) {
    return explicit.startsWith('~/')
      ? path.join(os.homedir(), explicit.slice(2))
      : explicit;
  }
  return path.join(os.homedir(), '.nimi', 'config.json');
}

function readRuntimeConfigGrpcAddr(mergedEnv: Record<string, string>): string {
  try {
    const config = JSON.parse(readFileSync(resolveRuntimeConfigPath(mergedEnv), 'utf8')) as {
      grpcAddr?: unknown;
    };
    const grpcAddr = String(config.grpcAddr || '').trim();
    return grpcAddr || '';
  } catch {
    return '';
  }
}

function resolveRuntimeGrpcAddr(mergedEnv: Record<string, string>): string {
  return String(mergedEnv.NIMI_RUNTIME_GRPC_ADDR || '').trim()
    || readRuntimeConfigGrpcAddr(mergedEnv)
    || DEFAULT_RUNTIME_GRPC_ADDR;
}

function buildDirectAudioSegment(input: {
  durationSec: number;
  audioBytes: Uint8Array;
  audioMimeType: string;
}): AudioSegment {
  let preparedBytes = input.audioBytes;
  let preparedMimeType = input.audioMimeType;
  try {
    preparedBytes = transcodeAudioToWavePcm16({
      sourceBytes: input.audioBytes,
      sourceFileName: 'audio-source.m4s',
    });
    preparedMimeType = 'audio/wav';
  } catch {
    preparedBytes = input.audioBytes;
    preparedMimeType = input.audioMimeType;
  }

  const preparedSize = preparedBytes.byteLength;
  const limitedBytes = preparedSize > DEFAULT_DIRECT_AUDIO_BYTES_LIMIT
    ? preparedBytes.subarray(0, DEFAULT_DIRECT_AUDIO_BYTES_LIMIT)
    : preparedBytes;
  const fullDurationSec = Math.max(0, Number(input.durationSec || 0));
  const ratio = preparedSize > 0 ? limitedBytes.byteLength / preparedSize : 1;
  const estimatedDurationSec = ratio >= 1
    ? fullDurationSec
    : Math.max(1, Math.floor(fullDurationSec * ratio));
  return {
    index: 1,
    startSec: 0,
    endSec: Math.min(fullDurationSec, estimatedDurationSec),
    bytes: limitedBytes,
    mimeType: preparedMimeType,
  };
}

export function buildTranscriptionSegments(input: {
  shouldSegment: boolean;
  durationSec: number;
  audioBytes: Uint8Array;
  audioMimeType: string;
}): AudioSegment[] {
  if (!input.shouldSegment) {
    return [buildDirectAudioSegment(input)];
  }

  try {
    return splitWaveIntoSegments({
      wavBytes: transcodeAudioToWavePcm16({
        sourceBytes: input.audioBytes,
        sourceFileName: 'audio-source.m4s',
      }),
      segmentDurationSec: DEFAULT_SEGMENT_DURATION_SEC,
      maxSegments: DEFAULT_MAX_SEGMENTS,
    });
  } catch {
    return [buildDirectAudioSegment(input)];
  }
}

async function transcribeAndExtract(input: {
  metadata: VideoMetadata;
  audioSourceUrl: string;
  mergedEnv: Record<string, string>;
}): Promise<Pick<FoodProbeResult, 'selectedSttModel' | 'rawCommentCount' | 'commentClues' | 'extractionCoverage' | 'transcript' | 'extractionRaw' | 'extractionJson'>> {
  const runtimeGrpcAddr = resolveRuntimeGrpcAddr(input.mergedEnv);
  const textModel = resolveTextModel({
    mergedEnv: input.mergedEnv,
  });

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
    const sttModel = resolveSttModel({
      durationSec: input.metadata.durationSec,
      mergedEnv: input.mergedEnv,
    });
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
        route: 'cloud',
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
    }
  }

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
  const extractionRaw = String(extracted.text || '').trim();
  const parsedExtractionJson = extractJsonObject(extractionRaw);
  const baseExtractionJson = await normalizeExtractionJsonToSimplified({
    runtime,
    textModel,
    extractionJson: parsedExtractionJson,
  });
  const rawComments = await fetchPublicComments(input.metadata.aid).catch(() => []);
  const crossCheckComments = filterCommentCluesForExtraction({
    extractionJson: baseExtractionJson,
    comments: rawComments,
  });
  const commentEnhancedJson = crossCheckComments.length > 0
    ? await runtime.ai.text.generate({
      model: textModel,
      input: buildCommentCrossCheckPrompt({
        metadata: input.metadata,
        transcript,
        extractionJson: baseExtractionJson,
        commentClues: crossCheckComments,
      }),
      route: 'cloud',
      timeoutMs: 240_000,
    }).then((response) => extractJsonObject(String(response.text || '').trim()))
    : baseExtractionJson;
  const normalizedCommentEnhancedJson = await normalizeExtractionJsonToSimplified({
    runtime,
    textModel,
    extractionJson: commentEnhancedJson || baseExtractionJson,
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
