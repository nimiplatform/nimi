/**
 * Prompt building, extraction, and normalization for bilibili food video probe.
 */

import type { Runtime } from '../../../../sdk/src/runtime/index.ts';
import {
  type AudioSegment,
  splitWaveIntoSegments,
  transcodeAudioToWavePcm16,
} from './bilibili-food-video-probe-audio.mts';
import type { VideoMetadata, FoodProbeResult } from './bilibili-food-video-probe.mts';
import type { CommentClue } from './bilibili-food-video-comment.mts';
import { summarizeCommentCluesForPrompt } from './bilibili-food-video-comment.mts';

const LIKELY_TRADITIONAL_ONLY_CHARS = new Set([
  ...'萬與專業叢東絲兩嚴喪個豐臨為麗舉麼義烏樂喬習鄉書買亂乾爭於虧雲亞產畝親褻見觀規覺覽觸計訊討讓訓議謝識證評話該詳誠語說讀調誰課請諸諾貝負財責貢貨販貧貴貸費貿賀資賓賴趙趕車軟轉輪辦這邊遙遞遠遷還郵鄧鄭鄰醫釀釋針鈣鈴鈦銀銅銘鋪錄錢錯鎮長門開間閃閉問闆陽陰際難從邊邏溫腸彈廣興偉發條區嗎對點幾價聽個數學嚟邊腸溫鎮廣場樓號補證雞麵館飲邊農莊餐廳點樣裡麵體灣灣燒雞氣廚餸鹹鮮雞豬腳飯麪館餃蝦蝦餅餵'.split(''),
]);

export function containsLikelyTraditionalChinese(value: unknown): boolean {
  const text = String(value || '');
  for (const ch of text) {
    if (LIKELY_TRADITIONAL_ONLY_CHARS.has(ch)) {
      return true;
    }
  }
  return false;
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
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

export async function normalizeExtractionJsonToSimplified(input: {
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
    'evidence 里可以加入"评论补充：..."这样的句子，保留原始线索。',
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

const DEFAULT_SHORT_AUDIO_STT_MODEL = 'qwen3-asr-flash';
const LONG_AUDIO_THRESHOLD_SEC = 300;
const DEFAULT_SEGMENT_DURATION_SEC = 240;
const DEFAULT_MAX_SEGMENTS = 3;
const DEFAULT_TEXT_MODEL = 'qwen-plus-latest';
const DEFAULT_DIRECT_AUDIO_BYTES_LIMIT = 6 * 1024 * 1024;

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

function buildDirectAudioSegment(input: {
  durationSec: number;
  audioBytes: Uint8Array;
  audioMimeType: string;
}): AudioSegment {
  const [preparedBytes, preparedMimeType] = (() => {
    try {
      return [transcodeAudioToWavePcm16({
        sourceBytes: input.audioBytes,
        sourceFileName: 'audio-source.m4s',
      }), 'audio/wav'] as const;
    } catch {
      return [input.audioBytes, input.audioMimeType] as const;
    }
  })();

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
