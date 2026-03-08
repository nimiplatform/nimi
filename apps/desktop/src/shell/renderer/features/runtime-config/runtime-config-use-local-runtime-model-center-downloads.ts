import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiDownloadProgressEvent,
} from '@runtime/local-ai-runtime';
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

type UseLocalRuntimeModelCenterDownloadsInput = {
  isModMode: boolean;
  onDownloadComplete?: DownloadCompleteHandler;
  onProgressSettled?: (event: LocalAiDownloadProgressEvent) => void;
};

export function useLocalRuntimeModelCenterDownloads(input: UseLocalRuntimeModelCenterDownloadsInput) {
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>(
    () => getCachedProgressSessions(),
  );
  const progressBySessionIdRef = useRef<Record<string, ProgressSessionState>>(getCachedProgressSessions());

  useEffect(() => {
    progressBySessionIdRef.current = progressBySessionId;
  }, [progressBySessionId]);

  useEffect(() => {
    if (input.isModMode) {
      return undefined;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    void localAiRuntime.listDownloads()
      .then((sessions) => {
        if (disposed) {
          return;
        }
        const nowMs = Date.now();
        setProgressBySessionId((prev) => {
          const next = pruneProgressSessions(prev, nowMs);
          const merged: Record<string, ProgressSessionState> = { ...next };
          for (const session of sessions) {
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
      .catch(() => {});

    void localAiRuntime.subscribeDownloadProgress((event) => {
      if (disposed) {
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
      .catch(() => {});
  }, []);

  const onPauseDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localAiRuntime.pauseDownload(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onResumeDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localAiRuntime.resumeDownload(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const onCancelDownload = useCallback((installSessionId: string) => {
    mergeSessionSummary(
      installSessionId,
      async () => toProgressEventFromSummary(await localAiRuntime.cancelDownload(installSessionId, { caller: 'core' })),
    );
  }, [mergeSessionSummary]);

  const activeDownloads = useMemo(
    () => sortProgressSessions(progressBySessionId)
      .slice(0, PROGRESS_SESSION_LIMIT)
      .map((item) => item.event)
      .filter((event) => (
        event.state === 'queued'
        || event.state === 'running'
        || event.state === 'paused'
        || event.state === 'failed'
      )),
    [progressBySessionId],
  );

  const getLatestProgressEvent = useCallback((installSessionId: string) => (
    progressBySessionIdRef.current[installSessionId]?.event
  ), []);

  return {
    activeDownloads,
    getLatestProgressEvent,
    onPauseDownload,
    onResumeDownload,
    onCancelDownload,
  };
}
