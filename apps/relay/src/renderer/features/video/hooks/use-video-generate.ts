// RL-FEAT-006 — Video Generation
// RL-CORE-002 — Agent binding propagation

import { useState, useCallback, useRef, useEffect } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

export type VideoJobStatus = 'idle' | 'submitting' | 'processing' | 'completed' | 'error';
type RelayBridge = ReturnType<typeof getBridge>;
type VideoGenerateResponse = Awaited<ReturnType<RelayBridge['media']['video']['generate']>>;
type VideoArtifactsResponse = Awaited<ReturnType<RelayBridge['media']['video']['job']['artifacts']>>;

export interface VideoResult {
  artifacts: VideoGenerateResponse['artifacts'];
  job: VideoGenerateResponse['job'];
}

function isScenarioJobEvent(value: unknown): value is { job?: { status?: number } } {
  return value !== null && typeof value === 'object' && 'job' in value;
}

export function useVideoGenerate() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [status, setStatus] = useState<VideoJobStatus>('idle');
  const [result, setResult] = useState<VideoResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeStreamRef = useRef<string | null>(null);

  // RL-CORE-002: Cancel in-flight video job when agent changes
  useEffect(() => {
    setResult(null);
    setStatus('idle');
    if (activeStreamRef.current) {
      getBridge().media.video.job.cancel(activeStreamRef.current);
      activeStreamRef.current = null;
    }
  }, [currentAgent?.id]);

  const generate = useCallback(async (prompt: string) => {
    if (!currentAgent || !runtimeAvailable) return;

    const bridge = getBridge();
    setStatus('submitting');
    setResult(null);
    setErrorMessage(null);

    try {
      // RL-CORE-004: agentId in input
      const response = await bridge.media.video.generate({
        agentId: currentAgent.id,
        prompt,
      });

      // If artifacts populated immediately (synchronous completion)
      if (response.artifacts && response.artifacts.length > 0) {
        setResult({ job: response.job, artifacts: response.artifacts });
        setStatus('completed');
        return;
      }

      // Async job — subscribe to job events (RL-IPC-003 stream protocol)
      setStatus('processing');
      const jobId = response.job.jobId;
      const { streamId } = await bridge.media.video.job.subscribe(jobId);
      activeStreamRef.current = streamId;

      const chunkId = bridge.stream.onChunk((payload) => {
        if (payload.streamId !== streamId) return;
        const event = payload.data;
        if (isScenarioJobEvent(event) && event.job?.status === 4) {
          // Fetch artifacts on completion
          bridge.media.video.job.artifacts(jobId).then((artifacts: VideoArtifactsResponse) => {
            setResult({ job: response.job, artifacts: artifacts.artifacts });
            setStatus('completed');
          });
        }
      });

      const cleanup = () => {
        bridge.stream.removeListener(chunkId);
        bridge.stream.removeListener(endId);
        bridge.stream.removeListener(errorId);
      };

      const endId = bridge.stream.onEnd((payload) => {
        if (payload.streamId !== streamId) return;
        activeStreamRef.current = null;
        cleanup();
      });

      const errorId = bridge.stream.onError((payload) => {
        if (payload.streamId !== streamId) return;
        const errObj = payload.error;
        const msg = errObj?.message || 'Video job stream error';
        console.error('[relay:video] job stream error', payload);
        setErrorMessage(msg);
        setStatus('error');
        activeStreamRef.current = null;
        cleanup();
      });
    } catch (err) {
      console.error('[relay:video] generate failed', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [currentAgent, runtimeAvailable]);

  const cancel = useCallback(() => {
    if (activeStreamRef.current) {
      getBridge().media.video.job.cancel(activeStreamRef.current);
      activeStreamRef.current = null;
      setStatus('idle');
    }
  }, []);

  return {
    generate,
    cancel,
    status,
    result,
    errorMessage,
    canGenerate: !!currentAgent && runtimeAvailable,
  };
}
