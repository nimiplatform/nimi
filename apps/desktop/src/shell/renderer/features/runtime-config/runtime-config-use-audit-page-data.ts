import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalAuditEvent } from '@nimiplatform/sdk/runtime/wire-types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
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

export function useAuditPageData(enabled: boolean, options?: { poll?: boolean }) {
  const poll = options?.poll ?? true;
  const bindings = useDesktopRendererBindings();
  const [loadingAudits, setLoadingAudits] = useState(false);
  const [auditEvents, setAuditEvents] = useState<LocalAuditEvent[]>([]);
  const [auditEventType, setAuditEventType] = useState('all');
  const [auditSource, setAuditSource] = useState('all');
  const [auditModality, setAuditModality] = useState('all');
  const [auditReasonCodeQuery, setAuditReasonCodeQuery] = useState('');
  const [auditTimeFrom, setAuditTimeFrom] = useState('');
  const [auditTimeTo, setAuditTimeTo] = useState('');
  const activeRequest = useRef<symbol | null>(null);

  const loadAudits = useCallback(async () => {
    // A refresh for the same filters must let the current read finish all its pages.
    if (activeRequest.current !== null) return;
    const request = Symbol();
    activeRequest.current = request;
    const timeFrom = toIsoTimeRangeValue(auditTimeFrom);
    const timeTo = toIsoTimeRangeValue(auditTimeTo);
    setLoadingAudits(true);
    try {
      const audits: LocalAuditEvent[] = [];
      let pageToken = '';
      do {
        const response = await bindings.sdk.localAudit().listLocalAudits({
          eventType: auditEventType && auditEventType !== 'all' ? auditEventType : '',
          eventTypes: [],
          source: auditSource && auditSource !== 'all' ? auditSource : '',
          modality: auditModality && auditModality !== 'all' ? auditModality : '',
          targetId: '',
          reasonCode: '',
          timeRange: timeFrom || timeTo
            ? { from: timeFrom || '', to: timeTo || '' }
            : undefined,
          pageSize: 500,
          pageToken,
          appId: '',
          subjectUserId: '',
        });
        if (activeRequest.current !== request) {
          return;
        }
        audits.push(...response.events);
        pageToken = String(response.nextPageToken || '').trim();
      } while (pageToken);
      setAuditEvents(audits);
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        setLoadingAudits(false);
      }
    }
  }, [auditEventType, auditModality, auditSource, auditTimeFrom, auditTimeTo, bindings.sdk]);

  useEffect(() => {
    if (!enabled) {
      setLoadingAudits(false);
      return;
    }
    void loadAudits();
    const schedule = (): (() => void) => bindings.clock.schedule(5000, (result) => {
      if (!result.ok) return;
      void loadAudits();
      cancel = schedule();
    });
    let cancel = poll ? schedule() : undefined;
    return () => {
      activeRequest.current = null;
      cancel?.();
    };
  }, [bindings.clock, enabled, loadAudits, poll]);

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
