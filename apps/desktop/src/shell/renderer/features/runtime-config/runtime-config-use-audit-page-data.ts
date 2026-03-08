import { useCallback, useEffect, useMemo, useState } from 'react';
import { localAiRuntime, type LocalAiAuditEvent } from '@runtime/local-ai-runtime';
import {
  filterAuditEvents,
  summarizeAuditReasons,
  summarizeAuditEventTypes,
  summarizeAuditSources,
  summarizeAuditModalities,
} from './runtime-config-audit-view-model.js';

function toIsoTimeRangeValue(value: string): string | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function useAuditPageData(enabled: boolean) {
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [auditEvents, setAuditEvents] = useState<LocalAiAuditEvent[]>([]);
  const [auditEventType, setAuditEventType] = useState('all');
  const [auditSource, setAuditSource] = useState('all');
  const [auditModality, setAuditModality] = useState('all');
  const [auditReasonCodeQuery, setAuditReasonCodeQuery] = useState('');
  const [auditTimeFrom, setAuditTimeFrom] = useState('');
  const [auditTimeTo, setAuditTimeTo] = useState('');

  const loadAudits = useCallback(async (overrides?: Partial<{
    eventType: string;
    source: string;
    modality: string;
    reasonCode: string;
    timeFrom: string;
    timeTo: string;
  }>) => {
    const eventType = overrides?.eventType ?? auditEventType;
    const source = overrides?.source ?? auditSource;
    const modality = overrides?.modality ?? auditModality;
    const reasonCode = (overrides?.reasonCode ?? auditReasonCodeQuery).trim();
    const timeFrom = toIsoTimeRangeValue(overrides?.timeFrom ?? auditTimeFrom);
    const timeTo = toIsoTimeRangeValue(overrides?.timeTo ?? auditTimeTo);
    setLoadingAudits(true);
    try {
      const audits = await localAiRuntime.listAudits({
        limit: 500,
        eventType: eventType && eventType !== 'all' ? eventType : undefined,
        source: source && source !== 'all' ? source : undefined,
        modality: modality && modality !== 'all' ? modality : undefined,
        reasonCode: reasonCode || undefined,
        timeRange: timeFrom || timeTo
          ? { from: timeFrom, to: timeTo }
          : undefined,
      });
      setAuditEvents(audits);
    } finally {
      setLoadingAudits(false);
    }
  }, [auditEventType, auditModality, auditReasonCodeQuery, auditSource, auditTimeFrom, auditTimeTo]);

  useEffect(() => {
    if (!enabled) return;
    void loadAudits();
    const timer = setInterval(() => {
      void loadAudits();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [enabled, loadAudits]);

  const filteredAudits = useMemo(
    () => filterAuditEvents({
      audits: auditEvents,
      eventType: auditEventType,
      source: auditSource,
      modality: auditModality,
      reasonCodeQuery: auditReasonCodeQuery,
      timeRange: {
        from: toIsoTimeRangeValue(auditTimeFrom),
        to: toIsoTimeRangeValue(auditTimeTo),
      },
    }),
    [auditEventType, auditEvents, auditModality, auditReasonCodeQuery, auditSource, auditTimeFrom, auditTimeTo],
  );

  const reasonBuckets = useMemo(() => summarizeAuditReasons(filteredAudits), [filteredAudits]);
  const eventTypeCounts = useMemo(() => summarizeAuditEventTypes(filteredAudits), [filteredAudits]);
  const sourceCounts = useMemo(() => summarizeAuditSources(filteredAudits), [filteredAudits]);
  const modalityCounts = useMemo(() => summarizeAuditModalities(filteredAudits), [filteredAudits]);

  return {
    auditEvents,
    filteredAudits,
    loadingAudits,
    auditEventType,
    setAuditEventType,
    auditSource,
    setAuditSource,
    auditModality,
    setAuditModality,
    auditReasonCodeQuery,
    setAuditReasonCodeQuery,
    auditTimeFrom,
    setAuditTimeFrom,
    auditTimeTo,
    setAuditTimeTo,
    loadAudits,
    eventTypeCounts,
    sourceCounts,
    modalityCounts,
    reasonBuckets,
  };
}
