import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localRuntime,
  type LocalRuntimeDownloadProgressEvent,
} from '@runtime/local-runtime';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
  PROGRESS_SESSION_LIMIT,
  type ProgressSessionState,
  toProgressEventFromSummary,
  parseTimestamp,
  pruneProgressSessions,
  sortProgressSessions,
} from './runtime-config-model-center-utils';
import {
  cacheProgressSessions,
  getCachedProgressSessions,
} from './runtime-config-local-model-center-helpers';

type DownloadCompleteHandler = (
  installSessionId: string,
  success: boolean,
  message?: string,
  localModelId?: string,
  modelId?: string,
) => void;

type UseLocalModelCenterDownloadsInput = {
  isModMode: boolean;
  onDownloadComplete?: DownloadCompleteHandler;
  onProgressSettled?: (event: LocalRuntimeDownloadProgressEvent) => void;
};

export function useLocalModelCenterDownloads(input: UseLocalModelCenterDownloadsInput) {
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>(
    () => getCachedProgressSessions(),
  );
  const progressBySessionIdRef = useRef<Record<string, ProgressSessionState>>(getCachedProgressSessions());
  const dismissedSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    progressBySessionIdRef.current = progressBySessionId;
  }, [progressBySessionId]);

  useEffect(() => {
    if (input.isModMode) {
      return undefined;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    void localRuntime.listDownloads()
      .then((sessions) => {
        if (disposed) {
          return;
        }
        const nowMs = Date.now();
        setProgressBySessionId((prev) => {
          const next = pruneProgressSessions(prev, nowMs);
          const merged: Record<string, ProgressSessionState> = { ...next };
          for (const session of sessions) {
            if (dismissedSessionIdsRef.current.has(session.installSessionId)) {
              continue;
            }
            const previous = next[session.installSessionId];
            merged[session.installSessionId] = {
              event: toProgressEventFromSummary(session),
              updatedAtMs: parseTimestamp(session.updatedAt) || nowMs,
              createdAtMs: previous?.createdAtMs || parseTimestamp(session.createdAt) || nowMs,
            };
          }
          return cacheProgressSessions(merged);
        });
      })
      .catch((err) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:listDownloads:failed',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      });

    void localRuntime.subscribeDownloadProgress((event) => {
      if (disposed) {
        return;
      }
      if (dismissedSessionIdsRef.current.has(event.installSessionId)) {
        return;
      }
      const nowMs = Date.now();
      setProgressBySessionId((prev) => {
        const next = pruneProgressSessions(prev, nowMs);
        const previous = next[event.installSessionId];
        return cacheProgressSessions({
          ...next,
          [event.installSessionId]: {
            event,
            updatedAtMs: nowMs,
            createdAtMs: previous?.createdAtMs || nowMs,
          },
        });
      });
      if (event.done) {
        input.onDownloadComplete?.(
          event.installSessionId,
          event.success,
          event.message,
          event.localModelId,
          event.modelId,
        );
        input.onProgressSettled?.(event);
      }
    }).then((off) => {
      if (disposed) {
        off();
        return;
      }
      unsubscribe = off;
    });

    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [input.isModMode, input.onDownloadComplete, input.onProgressSettled]);

  const mergeSessionSummary = useCallback((
    installSessionId: string,
    updater: () => Promise<ReturnType<typeof toProgressEventFromSummary>>,
  ) => {
    void updater()
      .then((event) => {
        const nowMs = Date.now();
        setProgressBySessionId((prev) => cacheProgressSessions({
          ...pruneProgressSessions(prev, nowMs),
          [installSessionId]: {
            event,
            updatedAtMs: nowMs,
            createdAtMs: prev[installSessionId]?.createdAtMs || nowMs,
          },
        }));
      })
      .catch((err) => {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai',
          message: 'action:mergeSessionSummary:failed',
          details: { installSessionId, error: err instanceof Error ? err.message : String(err) },
        });
      });
  }, []);

  const onPauseDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localRuntime.pauseDownload(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onResumeDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localRuntime.resumeDownload(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onCancelDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localRuntime.cancelDownload(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onDismissSession = useCallback((installSessionId: string) => {
    dismissedSessionIdsRef.current.add(installSessionId);
    setProgressBySessionId((prev) => {
      const next = { ...prev };
      delete next[installSessionId];
      cacheProgressSessions(next);
      return next;
    });
    progressBySessionIdRef.current = { ...progressBySessionIdRef.current };
    delete progressBySessionIdRef.current[installSessionId];
  }, []);

  const activeDownloads = useMemo(
    () => sortProgressSessions(progressBySessionId)
      .map((item) => item.event)
      .filter((event) => event.sessionKind === 'download')
      .filter((event) => (
        event.state === 'queued'
        || event.state === 'running'
        || event.state === 'paused'
        || event.state === 'failed'
      ))
      .slice(0, PROGRESS_SESSION_LIMIT),
    [progressBySessionId],
  );

  const activeImports = useMemo(
    () => sortProgressSessions(progressBySessionId)
      .map((item) => item.event)
      .filter((event) => event.sessionKind === 'import')
      .filter((event) => (
        event.state === 'queued'
        || event.state === 'running'
        || event.state === 'paused'
        || event.state === 'failed'
      ))
      .slice(0, PROGRESS_SESSION_LIMIT),
    [progressBySessionId],
  );

  const getLatestProgressEvent = useCallback((installSessionId: string) => (
    progressBySessionIdRef.current[installSessionId]?.event
  ), []);

  return {
    activeDownloads,
    activeImports,
    getLatestProgressEvent,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
    onDismissSession,
  };
}
