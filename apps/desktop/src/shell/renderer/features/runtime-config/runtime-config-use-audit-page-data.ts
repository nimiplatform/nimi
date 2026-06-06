import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocalAuditEvent } from '@nimiplatform/sdk/runtime/generated';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
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
  const [auditEvents, setAuditEvents] = useState<LocalAuditEvent[]>([]);
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
      const audits: LocalAuditEvent[] = [];
      let pageToken = '';
      do {
        const response = await getDesktopRuntime().local.listLocalAudits({
          eventType: eventType && eventType !== 'all' ? eventType : '',
          eventTypes: [],
          source: source && source !== 'all' ? source : '',
          modality: modality && modality !== 'all' ? modality : '',
          localModelId: '',
          targetId: '',
          reasonCode: reasonCode || '',
          timeRange: timeFrom || timeTo
            ? { from: timeFrom || '', to: timeTo || '' }
            : undefined,
          pageSize: 500,
          pageToken,
          appId: '',
          subjectUserId: '',
        });
        audits.push(...response.events);
        pageToken = String(response.nextPageToken || '').trim();
      } while (pageToken);
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
