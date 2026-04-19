import { REVIEWED_DOMAINS } from '../../knowledge-base/index.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import type { AdvisorSnapshot } from './advisor-boundary.js';

export type AdvisorSuggestion = {
  id: string;
  question: string;
};

const MIN_COUNT = 3;
const MAX_COUNT = 4;
const MIN_LEN = 4;
const MAX_LEN = 24;

const HARD_BAN = /诊断|治疗|发育迟缓|建议用药|建议服用|推荐治疗|障碍/u;

function summarizeLatestMeasurement(snapshot: AdvisorSnapshot) {
  const latest = [...snapshot.measurements]
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))
    .slice(0, 3)
    .map((m) => `${m.typeId}:${m.value}@${m.measuredAt.slice(0, 10)}`);
  return latest.join('；') || '无';
}

function buildCompactSnapshot(snapshot: AdvisorSnapshot) {
  return {
    childName: snapshot.child.displayName,
    gender: snapshot.child.gender,
    ageMonths: snapshot.ageMonths,
    nurtureMode: snapshot.child.nurtureMode,
    counts: {
      measurements: snapshot.measurements.length,
      vaccines: snapshot.vaccines.length,
      milestones: snapshot.milestones.length,
      journalEntries: snapshot.journalEntries.length,
      outdoorRecords: snapshot.outdoorRecords.length,
    },
    latestMeasurements: summarizeLatestMeasurement(snapshot),
    outdoorGoalMinutes: snapshot.outdoorGoalMinutes,
  };
}

function buildSystemPrompt() {
  return `你是 ParentOS 的"推荐问题"助手。
基于家长提供的孩子本地快照，生成家长最可能想问的 ${MIN_COUNT}-${MAX_COUNT} 个问题。

要求：
- 家长第一人称视角，每条一句问题，长度 ${MIN_LEN}-${MAX_LEN} 个字符，以问号结尾；越短越好，不要铺垫。
- 不要在问题里重复孩子名字或年龄，也不要复述快照中的数据细节——那些在界面上已经展示过。
- 只围绕已审核领域：${REVIEWED_DOMAINS.join('、')}。
- 不生成诊断型、评估型、排名型、风险结论型问题；不要使用"诊断 / 治疗 / 发育迟缓 / 障碍"等词。
- 只输出一个 JSON 数组，如 ["问题一？","问题二？"]。不要任何解释、标题、前后缀或代码块围栏。`;
}

function buildUserPrompt(snapshot: AdvisorSnapshot) {
  const compact = buildCompactSnapshot(snapshot);
  return [
    '孩子本地快照（JSON，仅供生成问题使用）：',
    JSON.stringify(compact),
    '',
    `请输出一个长度在 ${MIN_COUNT}-${MAX_COUNT} 之间的 JSON 字符串数组。`,
  ].join('\n');
}

function stripCodeFence(text: string) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractJsonArray(text: string): unknown {
  const stripped = stripCodeFence(text);
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new Error('suggestion output missing JSON array');
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

function extractStringsFallback(text: string): string[] {
  const matches = text.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g);
  if (!matches) return [];
  return matches
    .map((m) => m.slice(1, -1))
    .filter((s) => /[？?]\s*$/.test(s));
}

function normalizeQuestion(raw: string): string | null {
  const cleaned = raw.trim().replace(/^[\-•\d.、\s]+/, '').trim();
  if (cleaned.length < MIN_LEN || cleaned.length > MAX_LEN) return null;
  const q = /[？?。.！!]$/.test(cleaned) ? cleaned.replace(/[。.！!]$/, '？') : `${cleaned}？`;
  if (HARD_BAN.test(q)) return null;
  return q;
}

export async function generateAdvisorSuggestions(
  snapshot: AdvisorSnapshot,
  options: { signal?: AbortSignal } = {},
): Promise<AdvisorSuggestion[]> {
  const { getPlatformClient } = await import('@nimiplatform/sdk');
  const client = getPlatformClient();
  const rt = client.runtime;
  if (!rt?.ai?.text?.generate) {
    throw new Error('runtime not available for suggestion generation');
  }

  const aiParams = await resolveParentosTextRuntimeConfig('parentos.advisor', {
    temperature: 0.7,
    maxTokens: 1024,
  });
  await ensureParentosLocalRuntimeReady({
    route: aiParams.route,
    localModelId: aiParams.localModelId,
    timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  });

  if (options.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const generated = await rt.ai.text.generate({
    ...aiParams,
    system: buildSystemPrompt(),
    input: [{ role: 'user', content: buildUserPrompt(snapshot) }],
    metadata: buildParentosRuntimeMetadata('parentos.advisor'),
  });
  if (options.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const rawText = generated.text ?? '';
  let rawItems: string[] = [];
  try {
    const parsed = extractJsonArray(rawText);
    if (Array.isArray(parsed)) {
      rawItems = parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    rawItems = [];
  }
  if (rawItems.length === 0) {
    rawItems = extractStringsFallback(rawText);
  }

  const questions = rawItems
    .map(normalizeQuestion)
    .filter((item): item is string => item !== null);

  const deduped = Array.from(new Set(questions)).slice(0, MAX_COUNT);
  if (deduped.length < MIN_COUNT) {
    console.warn('[advisor-suggestions] insufficient after filter', {
      count: deduped.length,
      rawItems,
      rawText: rawText.slice(0, 500),
    });
    throw new Error(`insufficient suggestions after filter: ${deduped.length}`);
  }

  return deduped.map((question, index) => ({
    id: `ai-${index}`,
    question,
  }));
}
