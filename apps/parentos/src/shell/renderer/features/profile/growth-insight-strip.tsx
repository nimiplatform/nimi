import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { getPlatformClient } from '@nimiplatform/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import { LEDE_TEMPLATES, type LedeTemplateInputs } from './growth-curve-page-shared.js';
import type {
  GrowthDetailSnapshot,
  GrowthHeadline,
  GrowthTrendStat,
} from './growth-detail-projection.js';

// growth-insight-strip.tsx — PO-GROWTH-DETAIL-003 inline AI insight surface
// (wave-B). Bounded descriptive-only generator under the advisor-contract
// vocabulary; vocabulary guard + length cap + fail-close fallback to
// LEDE_TEMPLATES. Mirrors the getPlatformClient(...).runtime.ai.text.generate
// pattern from ai-summary-card.tsx; single call site.

// design.md §7 — SYSTEM_PROMPT envelope verbatim.
const SYSTEM_PROMPT = [
  '你是 ParentOS 内嵌的儿童生长描述助手。你只生成对家长可见的客观描述，',
  '60-120 个汉字，单段，无项目符号。',
  '你只能使用："观察到"、"可能"、"倾向于"、"处于…水平"、"建议咨询专业人士"。',
  '你绝对不能使用："落后"、"异常"、"危险"、"警告"、"发育迟缓"、"障碍"、',
  '"应该吃"、"建议用药"、"建议服用"、"推荐治疗"、"达不到"、"未达到"。',
  '若数据偏离参考区间，仅描述数据 + 建议家长咨询专业人士，不做病因或干预解释。',
  '请返回 JSON 对象，shape: {"insight": "<60-120 汉字描述>"}。',
].join('\n');

// design.md §7 — user message template verbatim with documented placeholders.
const USER_PROMPT_TEMPLATE = [
  '孩子：{displayName}（{gender}，{ageLabel}）',
  '指标：{metricDisplayName}',
  '当前值：{currentValueDisplay}（{measuredAt}）',
  '当前百分位：{currentPercentileLabel}',
  '年增速：{yearOverYearDeltaDisplay}',
  '距 P50：{distanceToP50Display}',
  '近 6 个月百分位变化：{percentileChange6mDisplay}',
  '最近 6 次测量（旧→新）：{compactHistoryListing}',
  '',
  '请用 60-120 汉字写一段对家长可见的客观描述。',
].join('\n');

const VOCAB_DENYLIST = [
  '落后',
  '异常',
  '危险',
  '警告',
  '发育迟缓',
  '障碍',
  '应该吃',
  '建议用药',
  '建议服用',
  '推荐治疗',
  '达不到',
  '未达到',
] as const;
const VOCAB_DENYLIST_REGEX = new RegExp(VOCAB_DENYLIST.join('|'), 'u');

const INSIGHT_MAX_LENGTH = 140;
const DEBOUNCE_MS = 30_000;
const SESSION_DAY_CAP = 20;
const FALLBACK_BADGE = 'AI 生成失败，已使用本地摘要';

const PROMPT_PLACEHOLDERS = [
  'displayName',
  'gender',
  'ageLabel',
  'metricDisplayName',
  'currentValueDisplay',
  'measuredAt',
  'currentPercentileLabel',
  'yearOverYearDeltaDisplay',
  'distanceToP50Display',
  'percentileChange6mDisplay',
  'compactHistoryListing',
] as const;

type PromptPlaceholder = (typeof PROMPT_PLACEHOLDERS)[number];
type PromptInputs = Record<PromptPlaceholder, string>;

export interface GrowthInsightStripProps {
  snapshot: GrowthDetailSnapshot;
  selectedMetricId: string;
}

function substituteUserTemplate(inputs: PromptInputs): string {
  let output = USER_PROMPT_TEMPLATE;
  for (const key of PROMPT_PLACEHOLDERS) {
    output = output.split(`{${key}}`).join(inputs[key]);
  }
  return output;
}

function findTrendStat(stats: readonly GrowthTrendStat[], label: string): GrowthTrendStat | null {
  for (const stat of stats) {
    if (stat.label === label) return stat;
  }
  return null;
}

function buildPromptInputs(snapshot: GrowthDetailSnapshot): PromptInputs | null {
  if (snapshot.headline.state === 'no_data') return null;
  const headline = snapshot.headline;
  const distanceStat = findTrendStat(snapshot.trendStats, '距 P50');
  const percentileStat = findTrendStat(snapshot.trendStats, '百分位');

  const yoyDisplay =
    headline.yearOverYearDelta.sign === '0'
      ? `±0 ${headline.yearOverYearDelta.unit}`
      : `${headline.yearOverYearDelta.sign}${headline.yearOverYearDelta.value} ${headline.yearOverYearDelta.unit}`;

  // History listing — last ≤6 rows from the projection's historyPage. The
  // projection already filters to the selected metric and orders newest-first;
  // we reverse to oldest→newest as the prompt envelope specifies.
  const historyRowsOldestFirst = [...snapshot.historyPage.rows].reverse().slice(-6);
  const compactHistoryListing = historyRowsOldestFirst.length
    ? historyRowsOldestFirst
        .map((row) => {
          const date = row.effectiveDate.split('T')[0] ?? row.effectiveDate;
          return `${date} ${row.value}${row.unit}`;
        })
        .join('；')
    : '近期暂无记录';

  return {
    displayName: snapshot.child.displayName,
    gender: snapshot.child.gender === 'F' ? '女' : '男',
    ageLabel: snapshot.child.ageLabel,
    metricDisplayName: snapshot.selectedMetric.displayName || '生长指标',
    currentValueDisplay: headline.currentValueDisplay,
    measuredAt: headline.measuredAt.split('T')[0] ?? headline.measuredAt,
    currentPercentileLabel: headline.ledeTemplateInputs.currentPercentileLabel,
    yearOverYearDeltaDisplay: yoyDisplay,
    distanceToP50Display: distanceStat ? `${distanceStat.value} ${distanceStat.unit}`.trim() : '—',
    percentileChange6mDisplay: percentileStat ? percentileStat.caption.replace(/^近 6 月 /, '') : '—',
    compactHistoryListing,
  };
}

function fallbackLine(headline: GrowthHeadline, fallbackUnit: string): string {
  if (headline.state === 'no_data') return LEDE_TEMPLATES.no_data({} as LedeTemplateInputs);
  const inputs: LedeTemplateInputs = {
    ...headline.ledeTemplateInputs,
    unit: headline.ledeTemplateInputs.unit || fallbackUnit,
  };
  return LEDE_TEMPLATES[headline.ledeTemplate](inputs);
}

function validateInsight(raw: string): { ok: true; value: string } | { ok: false } {
  // Parse — model is instructed to return {"insight": string}. Accept either a
  // bare JSON object or a JSON object wrapped in code fences (a model habit).
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false };
  const insight = (parsed as { insight?: unknown }).insight;
  if (typeof insight !== 'string' || insight.length === 0) return { ok: false };
  if (VOCAB_DENYLIST_REGEX.test(insight)) return { ok: false };
  const truncated = insight.length > INSIGHT_MAX_LENGTH ? `${insight.slice(0, INSIGHT_MAX_LENGTH)}…` : insight;
  return { ok: true, value: truncated };
}

type StripState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ai-success'; insight: string }
  | { kind: 'fallback' };

export function GrowthInsightStrip(props: GrowthInsightStripProps) {
  const { snapshot, selectedMetricId } = props;
  const childId = snapshot.child.childId;
  const promptInputs = useMemo(() => buildPromptInputs(snapshot), [snapshot]);
  const fallback = useMemo(
    () => fallbackLine(snapshot.headline, snapshot.selectedMetric.unit),
    [snapshot.headline, snapshot.selectedMetric.unit],
  );
  const [state, setState] = useState<StripState>({ kind: 'idle' });

  const lastCallAtRef = useRef<Map<string, number>>(new Map());
  const successCountRef = useRef(0);
  const inFlightKeyRef = useRef<string | null>(null);

  const runGenerate = useCallback(async () => {
    if (!promptInputs) {
      setState({ kind: 'fallback' });
      return;
    }
    if (successCountRef.current >= SESSION_DAY_CAP) {
      setState({ kind: 'fallback' });
      return;
    }
    const callKey = `${childId}|${selectedMetricId}`;
    if (inFlightKeyRef.current === callKey) return;
    inFlightKeyRef.current = callKey;
    setState({ kind: 'loading' });
    try {
      const client = getPlatformClient();
      const surfaceId = `parentos.profile.summary.growth-insight-${selectedMetricId}` as const;
      const aiParams = await resolveParentosTextRuntimeConfig(surfaceId, {
        temperature: 0.3,
        maxTokens: 256,
      });
      await ensureParentosLocalRuntimeReady({
        route: aiParams.route,
        localModelId: aiParams.localModelId,
        timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
      });
      const output = await client.runtime.ai.text.generate({
        ...aiParams,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: substituteUserTemplate(promptInputs) },
        ],
        metadata: buildParentosRuntimeMetadata(surfaceId),
      });
      const validation = validateInsight(output.text ?? '');
      if (!validation.ok) {
        setState({ kind: 'fallback' });
        return;
      }
      successCountRef.current += 1;
      setState({ kind: 'ai-success', insight: validation.value });
    } catch {
      setState({ kind: 'fallback' });
    } finally {
      inFlightKeyRef.current = null;
    }
  }, [childId, promptInputs, selectedMetricId]);

  const tryRefresh = useCallback(() => {
    if (successCountRef.current >= SESSION_DAY_CAP) {
      setState({ kind: 'fallback' });
      return;
    }
    const key = `${childId}|${selectedMetricId}`;
    const last = lastCallAtRef.current.get(key) ?? 0;
    if (Date.now() - last < DEBOUNCE_MS) return;
    lastCallAtRef.current.set(key, Date.now());
    void runGenerate();
  }, [childId, selectedMetricId, runGenerate]);

  useEffect(() => {
    if (!promptInputs) {
      setState({ kind: 'fallback' });
      return;
    }
    const key = `${childId}|${selectedMetricId}`;
    const last = lastCallAtRef.current.get(key) ?? 0;
    if (Date.now() - last < DEBOUNCE_MS) {
      // Already generated for this tuple in the last 30s; reuse fallback as
      // placeholder until the user explicitly refreshes.
      if (state.kind === 'idle') setState({ kind: 'fallback' });
      return;
    }
    lastCallAtRef.current.set(key, Date.now());
    void runGenerate();
    // Intentionally re-run only on (childId, selectedMetricId) tuple change;
    // the debounce ref guards against re-entry within a 30s window. The
    // closure-captured `runGenerate` / `promptInputs` always reflect the
    // latest snapshot via React's render-phase capture.
  }, [childId, selectedMetricId, runGenerate, promptInputs]);

  const capReached = successCountRef.current >= SESSION_DAY_CAP;
  const refreshDisabled = state.kind === 'loading' || capReached;

  const body =
    state.kind === 'ai-success'
      ? (
        <p className="text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">{state.insight}</p>
      )
      : state.kind === 'loading'
        ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-3 w-full animate-pulse rounded-full bg-[var(--nimi-surface-active)]" />
            <div className="h-3 w-4/5 animate-pulse rounded-full bg-[var(--nimi-surface-active)]" />
          </div>
        )
        : (
          <div data-testid="growth-insight-fallback">
            <p className="text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">{fallback}</p>
            <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--nimi-text-muted)]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-info)]"
                aria-hidden="true"
              />
              {FALLBACK_BADGE}
            </p>
          </div>
        );

  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="md"
      className="mb-5"
      data-testid="growth-insight-strip"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">✨</span>
          <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">今日洞察</h3>
        </div>
        <Button
          onClick={tryRefresh}
          disabled={refreshDisabled}
          tone="ghost"
          size="sm"
          title={capReached ? '本会话 AI 洞察额度已用完，请明日再试' : '重新分析'}
        >
          {state.kind === 'loading' ? '生成中' : '重新分析'}
        </Button>
      </div>
      {body}
    </Surface>
  );
}
