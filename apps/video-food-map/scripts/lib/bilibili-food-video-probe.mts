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

export type CommentScreeningRecord = {
  commentId: string;
  authorName: string;
  message: string;
  likeCount: number;
  publishedAt: string;
  matchedVenueNames: string[];
  addressHint: string;
  keep: boolean;
  reason: string;
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
const LIKELY_TRADITIONAL_ONLY_CHARS = new Set([
  ...'萬與專業叢東絲兩嚴喪個豐臨為麗舉麼義烏樂喬習鄉書買亂乾爭於虧雲亞產畝親褻見觀規覺覽觸計訊討讓訓議謝識證評話該詳誠語說讀調誰課請諸諾貝負財責貢貨販貧貴貸費貿賀資賓賴趙趕車軟轉輪辦這邊遙遞遠遷還郵鄧鄭鄰醫釀釋針鈣鈴鈦銀銅銘鋪錄錢錯鎮長門開間閃閉問闆陽陰際難從邊邏溫腸彈廣興偉發條區嗎對點幾價聽個數學嚟邊腸溫鎮廣場樓號補證雞麵館飲邊農莊餐廳點樣裡麵體灣灣燒雞氣廚餸鹹鮮雞豬腳飯麪館餃蝦蝦餅餵'.split(''),
]);

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

export function containsLikelyTraditionalChinese(value: unknown): boolean {
  const text = String(value || '');
  for (const ch of text) {
    if (LIKELY_TRADITIONAL_ONLY_CHARS.has(ch)) {
      return true;
    }
  }
  return false;
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

function extractStructuredVenueAddressPairsFromComment(message: string): Array<{
  venueName: string;
  addressHint: string;
}> {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return [];
  }

  const matches = [
    ...normalized.matchAll(
      /(?:🏠)?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,32}(?:美食|粉店|卷筒粉|猪脚粉|鸡粉|老友粉|牛肉粉|牛腩粉|餐厅|小食店|面馆|大排档|食店|食府))\s*(?:\([^)]*\))?\s*[，,]?\s*(?:📍)?\s*位于[:：]\s*([^🏠📍]{4,48}?)(?=\s*(?:🏠|📍|$))/gu,
    ),
  ];

  const pairs = matches
    .map((entry) => ({
      venueName: String(entry[1] || '').trim(),
      addressHint: String(entry[2] || '')
        .replace(/[，,。；;]+$/u, '')
        .trim(),
    }))
    .filter((entry) => entry.venueName && entry.addressHint && isPreciseCommentAddressText(entry.addressHint));

  const deduped = new Map<string, { venueName: string; addressHint: string }>();
  for (const pair of pairs) {
    const key = normalizeForCompare(`${pair.venueName}|${pair.addressHint}`);
    if (!deduped.has(key)) {
      deduped.set(key, pair);
    }
  }
  return [...deduped.values()];
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

function isLikelyVenueNameHint(value: string): boolean {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  const blockedPrefixes = ['求', '问', '請問', '请问', '有冇', '有没有', '系咪', '是不是', '住咩', '住乜', '哪家', '邊間', '边间'];
  if (blockedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (normalized.includes('店名') || normalized.includes('酒店名')) {
    return false;
  }
  return true;
}

function extractVenueNameHintsFromComment(message: string): string[] {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return [];
  }
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:小食店|餐厅|农庄|酒店|酒楼|饭店|面馆|粉店|卷筒粉|猪脚粉|鸡粉|老友粉|牛肉粉|海鲜粉|肠粉|茶餐厅|烧腊店|烧鹅店|烧烤店|甜品店|咖啡店|大排档|食店|食府|茶档|排档|美食))/gu;
  const matches = [...normalized.matchAll(pattern)]
    .map((entry) => String(entry[1] || '').trim())
    .filter((entry) => Boolean(entry) && isLikelyVenueNameHint(entry));
  return [...new Set(matches)];
}

function hasCrossCheckCue(message: string): boolean {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return false;
  }
  const markers = ['本期', '具体地址', '导航', '到店', '地图', '就在', '斜对面', '楼下'];
  return markers.some((marker) => normalized.includes(marker));
}

function hasUsefulCommentBody(message: string): boolean {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return false;
  }
  if (normalized.length < 4) {
    return false;
  }
  return /[\u4e00-\u9fa5A-Za-z0-9]/u.test(normalized);
}

function isLikelyNoiseComment(message: string): boolean {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return true;
  }
  const exactNoise = ['求店名', '求咩酒店', '求什么酒店', '求酒店名', '住咩酒店', '唔会', '老乡'];
  if (exactNoise.includes(normalized)) {
    return true;
  }
  if (normalized.length <= 8 && (normalized.startsWith('求') || normalized.startsWith('问'))) {
    return true;
  }
  return false;
}

function buildCommentClue(input: {
  comment: ReplyApiItem;
  knownVenueNames: string[];
}): CommentClue | null {
  const message = String(input.comment.content?.message || '').replace(/\s+/gu, ' ').trim();
  if (!message) {
    return null;
  }
  if (isLikelyNoiseComment(message)) {
    return null;
  }
  const normalizedMessage = normalizeForCompare(message);
  const matchedKnownVenueNames = input.knownVenueNames.filter((venueName) =>
    normalizedMessage.includes(normalizeForCompare(venueName)),
  );
  const extractedVenueHints = extractVenueNameHintsFromComment(message);
  const matchedVenueNames = [...new Set([...matchedKnownVenueNames, ...extractedVenueHints])];
  const addressHint = extractAddressHintFromComment(message);
  const likeCount = Number(input.comment.like || 0);
  const shouldKeep = matchedVenueNames.length > 0
    || Boolean(addressHint)
    || hasCrossCheckCue(message)
    || (likeCount > 0 && hasUsefulCommentBody(message));
  if (!shouldKeep) {
    return null;
  }
  return {
    commentId: String(input.comment.rpid || '').trim(),
    authorName: String(input.comment.member?.uname || '').trim(),
    message,
    likeCount,
    publishedAt: formatPublishedAt(Number(input.comment.ctime || 0)),
    matchedVenueNames,
    addressHint,
  };
}

export function screenCommentsForExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  comments: ReplyApiItem[];
}): CommentScreeningRecord[] {
  const knownVenueNames = readVenueNameCandidates(input.extractionJson);
  return input.comments.flatMap((comment) => {
    const message = String(comment.content?.message || '').replace(/\s+/gu, ' ').trim();
    const likeCount = Number(comment.like || 0);
    const publishedAt = formatPublishedAt(Number(comment.ctime || 0));
    const authorName = String(comment.member?.uname || '').trim();
    const commentId = String(comment.rpid || '').trim();
    const structuredPairs = extractStructuredVenueAddressPairsFromComment(message);

    if (!message) {
      return [{
        commentId,
        authorName,
        message,
        likeCount,
        publishedAt,
        matchedVenueNames: [],
        addressHint: '',
        keep: false,
        reason: '空评论',
      }];
    }

    if (isLikelyNoiseComment(message)) {
      return [{
        commentId,
        authorName,
        message,
        likeCount,
        publishedAt,
        matchedVenueNames: [],
        addressHint: '',
        keep: false,
        reason: '明显噪声',
      }];
    }

    const normalizedMessage = normalizeForCompare(message);
    const matchedKnownVenueNames = knownVenueNames.filter((venueName) =>
      normalizedMessage.includes(normalizeForCompare(venueName)),
    );
    const extractedVenueHints = extractVenueNameHintsFromComment(message);
    const matchedVenueNames = [...new Set([...matchedKnownVenueNames, ...extractedVenueHints])];
    const addressHint = extractAddressHintFromComment(message);
    const hasCue = hasCrossCheckCue(message);
    const likedGeneric = likeCount > 0 && hasUsefulCommentBody(message);
    const keep = matchedVenueNames.length > 0 || Boolean(addressHint) || hasCue || likedGeneric;
    let reason = '无明显线索';
    if (matchedVenueNames.length > 0) {
      reason = '命中店名';
    } else if (addressHint) {
      reason = '命中地址';
    } else if (hasCue) {
      reason = '命中强线索词';
    } else if (likedGeneric) {
      reason = '点赞评论进入候选池';
    }

    const baseRecord = {
      commentId,
      authorName,
      message,
      likeCount,
      publishedAt,
      matchedVenueNames,
      addressHint,
      keep,
      reason,
    };

    if (structuredPairs.length === 0) {
      return [baseRecord];
    }

    const expandedRecords = structuredPairs.map((pair, index) => ({
      ...baseRecord,
      commentId: `${commentId}#${index + 1}`,
      matchedVenueNames: [...new Set([...matchedVenueNames, pair.venueName])],
      addressHint: pair.addressHint,
      keep: true,
      reason: '命中店名和地址清单',
    }));

    if (
      baseRecord.keep
      && !expandedRecords.some((record) =>
        normalizeForCompare(record.addressHint) === normalizeForCompare(baseRecord.addressHint)
        && normalizeForCompare(record.matchedVenueNames.join('|')) === normalizeForCompare(baseRecord.matchedVenueNames.join('|')),
      )
    ) {
      expandedRecords.push(baseRecord);
    }

    return expandedRecords;
  });
}

export function filterCommentCluesForExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  comments: ReplyApiItem[];
}): CommentClue[] {
  const clues = screenCommentsForExtraction(input)
    .filter((item) => item.keep)
    .map((item) => ({
      commentId: item.commentId,
      authorName: item.authorName,
      message: item.message,
      likeCount: item.likeCount,
      publishedAt: item.publishedAt,
      matchedVenueNames: item.matchedVenueNames,
      addressHint: item.addressHint,
    }));

  const deduped = new Map<string, CommentClue>();
  for (const clue of clues) {
    const key = normalizeForCompare(`${clue.matchedVenueNames.join('|')}|${clue.addressHint}|${clue.message}`);
    if (!deduped.has(key)) {
      deduped.set(key, clue);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const leftScore = (left.matchedVenueNames.length * 20)
        + (left.addressHint ? 12 : 0)
        + (hasCrossCheckCue(left.message) ? 8 : 0)
        + Math.min(left.likeCount, 20)
        + Math.min(Math.floor(left.message.length / 24), 4);
      const rightScore = (right.matchedVenueNames.length * 20)
        + (right.addressHint ? 12 : 0)
        + (hasCrossCheckCue(right.message) ? 8 : 0)
        + Math.min(right.likeCount, 20)
        + Math.min(Math.floor(right.message.length / 24), 4);
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

  const existingVenueNames = new Set(
    venues
      .map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? normalizeForCompare(String((entry as Record<string, unknown>).venue_name || ''))
          : '',
      )
      .filter(Boolean),
  );
  const groupedCommentOnlyClues = new Map<string, CommentClue[]>();
  for (const clue of input.commentClues) {
    for (const venueName of clue.matchedVenueNames) {
      const normalizedVenueName = normalizeForCompare(venueName);
      if (!normalizedVenueName || existingVenueNames.has(normalizedVenueName)) {
        continue;
      }
      const bucket = groupedCommentOnlyClues.get(normalizedVenueName) || [];
      bucket.push(clue);
      groupedCommentOnlyClues.set(normalizedVenueName, bucket);
    }
  }

  for (const [normalizedVenueName, clueGroup] of groupedCommentOnlyClues.entries()) {
    const firstNamedClue = clueGroup.find((clue) =>
      clue.matchedVenueNames.some((venueName) => normalizeForCompare(venueName) === normalizedVenueName),
    );
    const venueName = firstNamedClue?.matchedVenueNames.find((name) =>
      normalizeForCompare(name) === normalizedVenueName,
    ) || '';
    if (!venueName) {
      continue;
    }

    const distinctHints = [...new Set(clueGroup.map((clue) => clue.addressHint.trim()).filter(Boolean))];
    const shouldCreateReviewVenue = clueGroup.length >= 2 || distinctHints.length > 0;
    if (!shouldCreateReviewVenue) {
      continue;
    }

    const evidence = clueGroup
      .slice(0, 3)
      .map((clue) => `评论补充：${clue.message}`);
    const addressText = distinctHints.length === 1 ? distinctHints[0]! : '';
    venues.push({
      venue_name: venueName,
      address_text: addressText,
      recommended_dishes: [],
      cuisine_tags: [],
      flavor_tags: [],
      evidence,
      recommendation_polarity: 'positive',
      confidence: distinctHints.length > 0 || clueGroup.length >= 3 ? 'medium' : 'low',
      needs_review: true,
    });
    if (distinctHints.length > 1) {
      uncertainPoints.push(`评论区对“${venueName}”给出了多个不同地址线索，先放进待确认。`);
    } else {
      uncertainPoints.push(`“${venueName}”目前主要来自评论线索，先放进待确认。`);
    }
    existingVenueNames.add(normalizedVenueName);
  }

  cloned.uncertain_points = [...new Set(uncertainPoints)];
  cloned.venues = venues;
  cloned.comment_clues = input.commentClues;
  return cloned;
}

function summarizeCommentCluesForPrompt(commentClues: CommentClue[]): Array<{
  commentId: string;
  authorName: string;
  likeCount: number;
  messages: string[];
  matchedVenueNames: string[];
  addressHints: string[];
}> {
  const grouped = new Map<string, {
    commentId: string;
    authorName: string;
    likeCount: number;
    messages: string[];
    matchedVenueNames: string[];
    addressHints: string[];
  }>();

  for (const clue of commentClues) {
    const baseCommentId = String(clue.commentId || '').split('#')[0] || String(clue.commentId || '');
    const key = `${baseCommentId}::${normalizeForCompare(clue.message)}`;
    const current = grouped.get(key) || {
      commentId: baseCommentId,
      authorName: clue.authorName,
      likeCount: clue.likeCount,
      messages: [],
      matchedVenueNames: [],
      addressHints: [],
    };
    if (!current.messages.includes(clue.message)) {
      current.messages.push(clue.message);
    }
    for (const venueName of clue.matchedVenueNames) {
      if (!current.matchedVenueNames.includes(venueName)) {
        current.matchedVenueNames.push(venueName);
      }
    }
    if (clue.addressHint && !current.addressHints.includes(clue.addressHint)) {
      current.addressHints.push(clue.addressHint);
    }
    current.likeCount = Math.max(current.likeCount, clue.likeCount);
    if (!current.authorName && clue.authorName) {
      current.authorName = clue.authorName;
    }
    grouped.set(key, current);
  }

  return [...grouped.values()];
}

async function normalizeExtractionJsonToSimplified(input: {
  runtime: Runtime;
  textModel: string;
  extractionJson: Record<string, unknown> | null;
}): Promise<Record<string, unknown> | null> {
  if (!input.extractionJson) {
    return null;
  }
  if (!containsLikelyTraditionalChinese(JSON.stringify(input.extractionJson))) {
    return input.extractionJson;
  }

  const normalized = await input.runtime.ai.text.generate({
    model: input.textModel,
    input: [
      '把下面这个 JSON 里的所有中文内容统一改成简体中文。',
      '这一步只做字形转换和极少量口语收口，不要改键名、结构、英文值、数字、布尔值、数组层级，也不要增删任何字段。',
      '如果原文里有粤语口语，可以保留原意，但字形必须改成简体。',
      '不要保留任何繁体字。请逐项检查所有字符串。',
      '示例：從化->从化，田邊村->田边村，肉腸粉->肉肠粉，溫泉鎮->温泉镇。',
      '只输出 JSON，不要输出解释。',
      '',
      JSON.stringify(input.extractionJson, null, 2),
    ].join('\n'),
    route: 'cloud',
    timeoutMs: 240_000,
  });
  return extractJsonObject(String(normalized.text || '').trim()) || input.extractionJson;
}

export function buildCommentCrossCheckPrompt(input: {
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
  const promptComments = summarizeCommentCluesForPrompt(input.commentClues);
  const commentBlock = promptComments.map((comment, index) => [
    `候选评论${index + 1}：`,
    `评论ID：${comment.commentId || '-'}`,
    `作者：${comment.authorName || '-'}`,
    `点赞：${comment.likeCount}`,
    `评论原文：`,
    ...comment.messages.map((message) => `- ${message}`),
    `本地提取到的可能店名：${comment.matchedVenueNames.join('、') || '-'}`,
    `本地提取到的可能地址：${comment.addressHints.join('；') || '-'}`,
  ].join('\n')).join('\n\n');

  return [
    '你是一个严格的信息核对助手，现在要用公开视频评论去补充第一轮视频提取结果。',
    '目标：结合视频转写、第一轮提取结果、评论线索，重新输出最终 JSON。',
    '评论原文比本地提取的辅助线索更重要。本地提取出来的店名和地址只作提示，不作最终事实。',
    '允许评论补店名、地址和证据，但必须和视频内容互相对得上。',
    '如果评论只是一条孤证，或者和视频内容冲突，不要直接当成确认事实。',
    '如果评论提供了新店名，但菜品、地点或行程能和视频内容对应上，可以补进 venue_name。',
    '如果评论提供了更具体地址，而视频原来只有模糊区域，可以补进 address_text。',
    '如果评论之间互相冲突，或者和视频内容冲突，要保留 needs_review=true，并把冲突写进 uncertain_points。',
    'evidence 里可以加入“评论补充：...”这样的句子，保留原始线索。',
    '输出必须是 JSON 对象，不要输出任何解释。',
    '所有中文字段一律使用简体中文输出，并且尽量使用简单直白的中文表达。',
    '即使转写内容或评论原文里出现繁体字，最终输出也必须统一改成简体中文，不要保留繁体字。',
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

function buildPromptCommentBlock(commentClues: CommentClue[]): string {
  const promptComments = summarizeCommentCluesForPrompt(commentClues);
  return promptComments.map((comment, index) => [
    `候选评论${index + 1}：`,
    `评论ID：${comment.commentId || '-'}`,
    `作者：${comment.authorName || '-'}`,
    `点赞：${comment.likeCount}`,
    '评论原文：',
    ...comment.messages.map((message) => `- ${message}`),
    `本地提取到的可能店名：${comment.matchedVenueNames.join('、') || '-'}`,
    `本地提取到的可能地址：${comment.addressHints.join('；') || '-'}`,
  ].join('\n')).join('\n\n');
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

export function buildFoodExtractionPrompt(input: {
  metadata: VideoMetadata;
  transcript: string;
  commentClues?: CommentClue[];
}): string {
  const metadataBlock = [
    `标题：${input.metadata.title}`,
    `作者：${input.metadata.ownerName}`,
    `简介：${input.metadata.description || '-'}`,
    `标签：${input.metadata.tags.join('、') || '-'}`,
  ].join('\n');
  const commentBlock = input.commentClues?.length
    ? buildPromptCommentBlock(input.commentClues)
    : '';

  return [
    '你是一个严格的信息提取助手，只能根据给定内容提取，不允许猜测。',
    '任务：结合视频转写和评论线索，提取被明确推荐的店和菜。',
    '视频转写是主证据，评论是补充证据。',
    '评论原文比本地提取的辅助线索更重要。本地提取出来的店名和地址只作提示，不作最终事实。',
    '如果评论能补充店名或更具体地址，但必须和视频内容互相对得上，才能写进最终结果。',
    '如果评论只是一条孤证，或者和视频内容冲突，不要直接当成确认事实。',
    '如果评论里反复提到某家店，但视频证据不足，可以把它写进 venues，同时 needs_review=true。',
    '输出必须是 JSON 对象，不要输出任何额外解释。',
    '所有中文字段一律使用简体中文输出，并且尽量使用简单直白的中文表达。',
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
    '5. 输出里的中文不要使用繁体字；如果原文是繁体，也要统一改成简体。',
    '6. 如果评论原文里一条评论列了多家店和多段地址，请以评论原文为准分别判断，不要只抓第一段。',
    '',
    '视频元信息：',
    metadataBlock,
    '',
    '转写内容：',
    input.transcript,
    ...(commentBlock ? ['', '评论线索：', commentBlock] : []),
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

  const rawComments = await fetchPublicComments(input.metadata.aid).catch(() => []);
  const crossCheckComments = filterCommentCluesForExtraction({
    extractionJson: null,
    comments: rawComments,
  });
  const extracted = await runtime.ai.text.generate({
    model: textModel,
    input: buildFoodExtractionPrompt({
      metadata: input.metadata,
      transcript,
      commentClues: crossCheckComments,
    }),
    route: 'cloud',
    timeoutMs: 240_000,
  });
  const extractionRaw = String(extracted.text || '').trim();
  const commentEnhancedJson = extractJsonObject(extractionRaw);
  const normalizedCommentEnhancedJson = await normalizeExtractionJsonToSimplified({
    runtime,
    textModel,
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
