import { useCallback, useMemo, useState } from 'react';

import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { getAppSetting, setAppSetting } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { computeAgeMonths } from '../../app-shell/app-store.js';
import { getPlatformClient } from '@nimiplatform/sdk';

import { analyzeMedicalEvents } from '../../engine/smart-alerts.js';
import type { MedicalAnalysis } from '../../engine/smart-alerts.js';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import { EVENT_TYPE_LABELS, SEVERITY_LABELS } from './medical-events-page-shared.js';
import type { MedicalEventsChildContext } from './medical-events-page-types.js';

export function useMedicalEventsInsights(
  child: MedicalEventsChildContext | undefined,
  events: MedicalEventRow[],
) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [eventAiLoading, setEventAiLoading] = useState<string | null>(null);
  const [eventAiResult, setEventAiResult] = useState<Record<string, string>>({});

  const analysis: MedicalAnalysis | null = useMemo(
    () => (events.length > 0 ? analyzeMedicalEvents(events) : null),
    [events],
  );

  const generateAIInsight = useCallback(async (skipCache = false) => {
    if (!child || !analysis || events.length === 0) return;
    const cacheKeyStr = `medical_insight_${child.childId}`;

    if (!skipCache) {
      try {
        const cached = await getAppSetting(cacheKeyStr);
        if (cached) {
          const parsed = JSON.parse(cached) as { text: string; ts: string };
          if (Date.now() - new Date(parsed.ts).getTime() < 24 * 60 * 60 * 1000) {
            setAiInsight(parsed.text);
            return;
          }
        }
      } catch {
        // ignore cache read failures
      }
    }

    setAiLoading(true);
    try {
      const diagSummary = analysis.diagnoses.slice(0, 10)
        .map((d) => `${d.diagnosis}(${d.count}次，末次${d.lastDate.split('T')[0]})`)
        .join('；');
      const medSummary = analysis.medications.slice(0, 10)
        .map((m) => `${m.name}(${m.count}次${m.dosage ? `，${m.dosage}` : ''})`)
        .join('；');
      const alertSummary = analysis.alerts
        .map((a) => `[${a.level}] ${a.title}`)
        .join('；');

      const ageMonths = computeAgeMonths(child.birthDate);
      const prompt = [
        '你是一位儿童健康记录整理助手。',
        '请根据以下就医记录摘要，为家长生成一段描述性总结（3-5句话）。',
        '要求：',
        '- 仅描述记录中可见的就医频率、重复出现的主题和照护记录概况',
        '- 如果存在值得留意的模式，只能说“可以继续留意”或“建议咨询专业人士”',
        '- 不给出用药合理性判断、治疗建议、复查建议或具体护理方案',
        '- 使用客观温和的语气，不使用焦虑性词汇',
        '- 仅输出分析文本',
        '',
        `孩子：${child.displayName}，${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月，${child.gender === 'female' ? '女' : '男'}`,
        `就医总次数：${analysis.totalEvents}`,
        `诊断汇总：${diagSummary || '无'}`,
        `用药汇总：${medSummary || '无'}`,
        `系统预警：${alertSummary || '无'}`,
        `常去医院：${analysis.frequentHospitals.join('、') || '未记录'}`,
      ].join('\n');

      const client = getPlatformClient();
      const insightParams = await resolveParentosTextRuntimeConfig('parentos.medical.smart-insight', { temperature: 0.3, maxTokens: 600 });
      await ensureParentosLocalRuntimeReady({
        route: insightParams.route,
        localModelId: insightParams.localModelId,
        timeoutMs: 60_000,
      });
      const output = await client.runtime.ai.text.generate({
        ...insightParams,
        input: [{ role: 'user', content: prompt }],
        metadata: buildParentosRuntimeMetadata('parentos.medical.smart-insight'),
      });

      const filtered = filterAIResponse(output.text);
      const text = filtered.safe ? filtered.filtered : '数据已记录，建议持续更新就医信息以获取更精准的健康分析。';
      setAiInsight(text);

      try {
        await setAppSetting(cacheKeyStr, JSON.stringify({ text, ts: isoNow() }), isoNow());
      } catch {
        // ignore cache write failures
      }
    } catch {
      setAiInsight(null);
    } finally {
      setAiLoading(false);
    }
  }, [analysis, child, events.length]);

  const analyzeEvent = useCallback(async (event: MedicalEventRow) => {
    if (!child) return;

    setEventAiLoading(event.eventId);
    try {
      const ageMonths = computeAgeMonths(child.birthDate);
      const prompt = [
        '你是一位儿童健康记录整理助手。请根据以下单次就医记录，给出简短的描述性总结（2-3句话）。',
        '要求：客观温和，仅概括本次记录中的症状、处理经过和已记录照护信息；不要给出复查建议、用药注意事项、治疗建议或护理方案。仅输出分析文本。',
        '',
        `孩子：${child.displayName}，${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`,
        `就诊类型：${EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}`,
        `诊断/症状：${event.title}`,
        `日期：${event.eventDate.split('T')[0]}`,
        event.severity ? `严重程度：${SEVERITY_LABELS[event.severity] ?? event.severity}` : '',
        event.hospital ? `医院：${event.hospital}` : '',
        event.medication ? `用药：${event.medication}${event.dosage ? `，剂量：${event.dosage}` : ''}` : '',
        event.notes ? `备注：${event.notes}` : '',
      ].filter(Boolean).join('\n');

      const client = getPlatformClient();
      const eventParams = await resolveParentosTextRuntimeConfig('parentos.medical.event-analysis', { temperature: 0.3, maxTokens: 300 });
      await ensureParentosLocalRuntimeReady({
        route: eventParams.route,
        localModelId: eventParams.localModelId,
        timeoutMs: 60_000,
      });
      const output = await client.runtime.ai.text.generate({
        ...eventParams,
        input: [{ role: 'user', content: prompt }],
        metadata: buildParentosRuntimeMetadata('parentos.medical.event-analysis'),
      });

      const filtered = filterAIResponse(output.text);
      setEventAiResult((prev) => ({
        ...prev,
        [event.eventId]: filtered.safe ? filtered.filtered : '暂无法生成分析，请确认 AI 运行时已启动。',
      }));
    } catch {
      setEventAiResult((prev) => ({
        ...prev,
        [event.eventId]: 'AI 分析暂不可用，请稍后重试。',
      }));
    } finally {
      setEventAiLoading(null);
    }
  }, [child]);

  const closeEventAnalysis = useCallback((eventId: string) => {
    setEventAiResult((prev) => {
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  }, []);

  return {
    analysis,
    showAnalysis,
    setShowAnalysis,
    aiInsight,
    aiLoading,
    eventAiLoading,
    eventAiResult,
    generateAIInsight,
    analyzeEvent,
    closeEventAnalysis,
  };
}
