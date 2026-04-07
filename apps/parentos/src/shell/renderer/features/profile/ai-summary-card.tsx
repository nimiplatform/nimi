/**
 * AISummaryCard — Reusable AI analysis summary for profile sub-pages.
 *
 * Displays a generated textual analysis based on the child's data for a given domain.
 * Caches results in AppSettings to avoid redundant AI calls.
 * Falls back gracefully when the AI runtime is unavailable.
 */
import { useState, useEffect, useCallback } from 'react';
import { S } from '../../app-shell/page-style.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getAppSetting, setAppSetting } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';

interface AISummaryCardProps {
  /** Unique domain key, e.g. 'growth', 'vaccine', 'vision' */
  domain: string;
  /** Child's name for display */
  childName: string;
  /** Child ID for cache key */
  childId: string;
  /** Age description, e.g. "9岁4个月" */
  ageLabel: string;
  /** Gender: 'male' | 'female' */
  gender: string;
  /**
   * Structured data context to send to AI.
   * Should be a human-readable summary of the page's data.
   * Pass empty string if no data exists.
   */
  dataContext: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  growth: '生长发育',
  milestone: '发育里程碑',
  vaccine: '疫苗接种',
  vision: '视力健康',
  dental: '口腔发育',
  allergy: '过敏管理',
  sleep: '睡眠习惯',
  medical: '健康记录',
  tanner: '青春期发育',
  fitness: '体能发展',
};

function cacheKey(childId: string, domain: string) {
  return `ai_summary_${childId}_${domain}`;
}

function buildPrompt(props: AISummaryCardProps): string {
  const label = DOMAIN_LABELS[props.domain] ?? props.domain;
  return [
    `你是一位专业的儿童${label}顾问。`,
    `请根据以下数据，为家长提供一段简洁的分析总结（2-4句话）。`,
    `要求：`,
    `- 使用客观、温和的语气`,
    `- 使用"观察到"、"建议关注"等表述`,
    `- 不使用"异常"、"落后"、"发育迟缓"等焦虑性词汇`,
    `- 如果数据充足，给出趋势观察；如果数据不足，建议补充哪些记录`,
    `- 仅输出分析文本，不要 markdown 格式`,
    ``,
    `孩子信息：${props.childName}，${props.ageLabel}，${props.gender === 'female' ? '女' : '男'}`,
    ``,
    `${label}数据：`,
    props.dataContext || '暂无记录数据',
  ].join('\n');
}

export function AISummaryCard(props: AISummaryCardProps) {
  const { domain, childId, dataContext } = props;
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const generate = useCallback(async (skipCache = false) => {
    if (!dataContext) return; // no data to analyze

    // Check cache first
    if (!skipCache) {
      try {
        const cached = await getAppSetting(cacheKey(childId, domain));
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as { text: string; ts: string };
            // Cache valid for 24h
            if (Date.now() - new Date(parsed.ts).getTime() < 24 * 60 * 60 * 1000) {
              setSummary(parsed.text);
              return;
            }
          } catch { /* stale cache, regenerate */ }
        }
      } catch { /* bridge unavailable */ }
    }

    setLoading(true);
    setError(false);
    try {
      const client = getPlatformClient();
      const output = await client.runtime.ai.text.generate({
        model: 'auto',
        temperature: 0.3,
        maxTokens: 400,
        input: [{ role: 'user', content: buildPrompt(props) }],
        metadata: {
          callerKind: 'third-party-app' as const,
          callerId: 'app.nimi.parentos',
          surfaceId: `parentos.profile.summary.${domain}`,
        },
      });

      const filtered = filterAIResponse(output.text);
      const text = filtered.safe ? filtered.filtered : '数据已记录，建议定期更新以获取更准确的分析。';
      setSummary(text);

      // Cache result
      try {
        await setAppSetting(cacheKey(childId, domain), JSON.stringify({ text, ts: isoNow() }), isoNow());
      } catch { /* cache write failure is non-critical */ }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [childId, domain, dataContext, props]);

  useEffect(() => { void generate(); }, [generate]);

  // No data at all — show a subtle hint
  if (!dataContext) {
    return (
      <div className={`${S.radius} p-4 mb-5 flex items-center gap-3`}
        style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
        <span className="text-[20px]">📊</span>
        <p className="text-[12px]" style={{ color: S.sub }}>记录更多数据后，AI 将为您生成分析报告</p>
      </div>
    );
  }

  return (
    <div className={`${S.radius} p-5 mb-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">✨</span>
          <h3 className="text-[13px] font-semibold" style={{ color: S.text }}>AI 分析</h3>
        </div>
        <button onClick={() => void generate(true)}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-colors hover:bg-[#f0f0ec] disabled:opacity-40"
          style={{ color: S.sub }}
          title="重新生成">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={loading ? 'animate-spin' : ''}>
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
          {loading ? '生成中' : '刷新'}
        </button>
      </div>

      {loading && !summary ? (
        /* Skeleton */
        <div className="space-y-2 animate-pulse">
          <div className="h-3 rounded-full w-full" style={{ background: '#eceeed' }} />
          <div className="h-3 rounded-full w-4/5" style={{ background: '#eceeed' }} />
          <div className="h-3 rounded-full w-3/5" style={{ background: '#eceeed' }} />
        </div>
      ) : error ? (
        <p className="text-[12px]" style={{ color: S.sub }}>
          AI 分析暂时不可用，请确认 AI 运行时已启动后重试。
        </p>
      ) : summary ? (
        <p className="text-[12px] leading-relaxed" style={{ color: S.text }}>{summary}</p>
      ) : null}
    </div>
  );
}
