// RL-FEAT-006 — Video Generation
// RL-CORE-002 — Agent binding propagation

import { useState, useCallback, useRef, useEffect } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

export type VideoJobStatus = 'idle' | 'submitting' | 'processing' | 'completed' | 'error';

export interface VideoResult {
  artifacts: unknown[];
  job: unknown;
}

export function useVideoGenerate() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const [status, setStatus] = useState<VideoJobStatus>('idle');
  const [result, setResult] = useState<VideoResult | null>(null);
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

    try {
      // RL-CORE-004: agentId in input
      const response = await bridge.media.video.generate({
        agentId: currentAgent.id,
        prompt,
      }) as { job: unknown; artifacts: unknown[]; trace?: unknown };

      // If artifacts populated immediately (synchronous completion)
      if (response.artifacts && (response.artifacts as unknown[]).length > 0) {
        setResult({ job: response.job, artifacts: response.artifacts });
        setStatus('completed');
        return;
      }

      // Async job — subscribe to job events (RL-IPC-003 stream protocol)
      setStatus('processing');
      const jobId = (response.job as { id: string }).id;
      const { streamId } = await bridge.media.video.job.subscribe(jobId);
      activeStreamRef.current = streamId;

      const chunkId = bridge.stream.onChunk((payload) => {
        if (payload.streamId !== streamId) return;
        // ScenarioJobEvent data shape
        const event = payload.data as { status?: string };
        if (event.status === 'completed') {
          // Fetch artifacts on completion
          bridge.media.video.job.artifacts(jobId).then((artifacts) => {
            setResult({ job: response.job, artifacts: artifacts as unknown[] });
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
        setStatus('error');
        activeStreamRef.current = null;
        cleanup();
      });
    } catch {
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
    canGenerate: !!currentAgent && runtimeAvailable,
  };
}
