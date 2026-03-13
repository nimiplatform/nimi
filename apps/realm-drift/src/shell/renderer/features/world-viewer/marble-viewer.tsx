import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { RawWorldContext } from './marble-prompt.js';
import { composeMarblePrompt, findWorldImageUrl, assembleRawContext } from './marble-prompt.js';
import { MarbleWorldGenerator } from './marble-world-generator.js';
import { marbleConfig } from './marble-api.js';

type MarbleViewerProps = {
  worldId: string;
  worldName: string;
  worldContext: RawWorldContext | null;
  quality: 'mini' | 'standard';
};

type ViewerState = 'idle' | 'generating' | 'completed' | 'failed';

const generator = new MarbleWorldGenerator();

export function MarbleViewer({ worldId, worldName, worldContext, quality }: MarbleViewerProps) {
  const { t } = useTranslation();
  const marbleJob = useAppStore((s) => s.marbleJobs[worldId]);
  const setMarbleJob = useAppStore((s) => s.setMarbleJob);
  const clearMarbleJob = useAppStore((s) => s.clearMarbleJob);
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const state: ViewerState = marbleJob?.status ?? 'idle';
  const viewerUrl = marbleJob?.viewerUrl;

  // Elapsed time counter during generation
  useEffect(() => {
    if (state !== 'generating') return;
    const start = marbleJob?.startedAt ?? Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [state, marbleJob?.startedAt]);

  // Resume polling if returning to a generating world
  useEffect(() => {
    const opId = marbleJob?.operationId;
    if (!(state === 'generating' && opId)) {
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;

    void (async () => {
      try {
        for await (const update of generator.poll(opId, ac.signal)) {
          if (ac.signal.aborted) return;
          if ('viewerUrl' in update && update.status === 'completed') {
            setMarbleJob(worldId, {
              operationId: opId,
              status: 'completed',
              viewerUrl: update.viewerUrl ?? undefined,
              marbleWorldId: ('worldId' in update ? update.worldId : null) ?? undefined,
              startedAt: marbleJob.startedAt,
            });
          } else if ('error' in update && update.status === 'failed') {
            setMarbleJob(worldId, {
              operationId: opId,
              status: 'failed',
              error: update.error ?? t('viewer.generationFailed'),
              startedAt: marbleJob.startedAt,
            });
            setErrorMessage(update.error ?? t('viewer.generationFailed'));
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : t('viewer.generationFailed');
        setMarbleJob(worldId, {
          operationId: opId,
          status: 'failed',
          error: msg,
          startedAt: marbleJob.startedAt,
        });
        setErrorMessage(mapErrorMessage(msg, t));
      }
    })();

    return () => ac.abort();
  }, []); // Only on mount — resume in-flight polling

  const handleGenerate = useCallback(async () => {
    if (!worldContext) return;

    const apiKey = marbleConfig.getApiKey();
    if (!apiKey) {
      setErrorMessage(t('viewer.missingApiKey'));
      setMarbleJob(worldId, {
        operationId: '',
        status: 'failed',
        error: t('viewer.missingApiKey'),
        startedAt: Date.now(),
      });
      return;
    }

    // Abort any previous
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const startedAt = Date.now();
    setMarbleJob(worldId, {
      operationId: '',
      status: 'generating',
      startedAt,
    });
    setElapsed(0);
    setErrorMessage('');
    setIframeLoaded(false);

    try {
      // Compose prompt
      const prompt = await composeMarblePrompt(worldContext, ac.signal);
      const imageUrl = findWorldImageUrl(worldContext);

      // Generate
      const genResult = await generator.generate(
        {
          displayName: worldName,
          textPrompt: prompt,
          imageUrl,
          quality: quality === 'mini' ? 'draft' : 'standard',
        },
        ac.signal,
      );
      const operationId = genResult.operationId;

      setMarbleJob(worldId, { operationId, status: 'generating', startedAt });

      // Poll via AsyncGenerator
      for await (const update of generator.poll(operationId, ac.signal)) {
        if (ac.signal.aborted) return;
        if ('viewerUrl' in update && update.status === 'completed') {
          setMarbleJob(worldId, {
            operationId,
            status: 'completed',
            viewerUrl: update.viewerUrl ?? undefined,
            marbleWorldId: ('worldId' in update ? update.worldId : null) ?? undefined,
            startedAt,
          });
        } else if ('error' in update && update.status === 'failed') {
          const msg = update.error ?? t('viewer.generationFailed');
          setErrorMessage(mapErrorMessage(msg, t));
          setMarbleJob(worldId, {
            operationId,
            status: 'failed',
            error: msg,
            startedAt,
          });
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      const msg = err instanceof Error ? err.message : t('viewer.generationFailed');
      setErrorMessage(mapErrorMessage(msg, t));
      setMarbleJob(worldId, {
        operationId: marbleJob?.operationId ?? '',
        status: 'failed',
        error: msg,
        startedAt,
      });
    }
  }, [worldContext, worldId, worldName, quality, t, setMarbleJob, marbleJob?.operationId]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Idle state
  if (state === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
        {worldContext && (
          <div className="w-full max-w-lg">
            <h3 className="text-sm font-medium text-neutral-400 mb-2">{t('viewer.promptPreview')}</h3>
            <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-4 text-xs text-neutral-400 max-h-48 overflow-auto text-left whitespace-pre-wrap">
              {assembleRawContext(worldContext).slice(0, 800)}
              {assembleRawContext(worldContext).length > 800 ? '...' : ''}
            </div>
          </div>
        )}
        <p className="text-sm text-neutral-500">{t('viewer.idle')}</p>
        <button
          onClick={() => void handleGenerate()}
          disabled={!worldContext}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          {t('viewer.generate')}
        </button>
      </div>
    );
  }

  // Generating state
  if (state === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-sm text-neutral-300">{t('viewer.generating')}</p>
        <p className="text-xs text-neutral-500">{t('viewer.elapsed', { seconds: elapsed })}</p>
        <p className="text-xs text-neutral-600">
          {quality === 'mini' ? t('viewer.estimatedTimeMini') : t('viewer.estimatedTimeStandard')}
        </p>
        <button
          onClick={() => {
            abortRef.current?.abort();
            clearMarbleJob(worldId);
          }}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors"
        >
          {t('viewer.cancel')}
        </button>
      </div>
    );
  }

  // Error state
  if (state === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <p className="text-red-400 text-sm">{errorMessage || marbleJob?.error || t('viewer.error')}</p>
        <div className="flex gap-3">
          <button
            onClick={() => void handleGenerate()}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 transition-colors"
          >
            {t('viewer.retry')}
          </button>
          <button
            onClick={() => clearMarbleJob(worldId)}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-700 transition-colors"
          >
            {t('viewer.editPrompt')}
          </button>
        </div>
      </div>
    );
  }

  // Ready state — iframe embed
  return (
    <div className="relative h-full w-full">
      {!iframeLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}
      {viewerUrl && (
        <iframe
          src={viewerUrl}
          title={t('viewer.iframeTitle')}
          className="h-full w-full border-0"
          onLoad={() => setIframeLoaded(true)}
          sandbox="allow-scripts allow-same-origin allow-popups"
          allow="autoplay; fullscreen"
        />
      )}
    </div>
  );
}

function mapErrorMessage(code: string, t: (key: string) => string): string {
  if (code === 'MARBLE_API_KEY_MISSING') return t('viewer.missingApiKey');
  if (code === 'MARBLE_RATE_LIMITED') return t('error.rateLimited');
  if (code === 'MARBLE_UNAUTHORIZED') return t('error.unauthorized');
  if (code === 'MARBLE_FORBIDDEN') return t('error.forbidden');
  if (code.startsWith('MARBLE_HTTP_5')) return t('error.serverError');
  if (code === 'MARBLE_POLL_TIMEOUT') return t('viewer.pollTimeout');
  if (code === 'MARBLE_NO_VIEWER_URL') return t('viewer.generationFailed');
  return code;
}
