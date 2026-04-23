/**
 * useImageGeneration — React hook for entity-aware image generation.
 *
 * Wraps the image-gen-client pipeline with React state tracking,
 * candidate management, upload actions, and asset-ops handoff.
 */

import { useCallback, useState } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import type {
  ImageGenCandidate,
  ImageGenEntityContext,
  ImageGenPhase,
} from '@renderer/data/image-gen-client.js';
import {
  generateEntityImage,
  uploadImageToCloudflare,
} from '@renderer/data/image-gen-client.js';
import {
  queueAgentAssetCandidate,
  type AgentAssetOpsCandidateRecord,
} from '@renderer/state/agent-asset-ops-store.js';
import {
  queueWorldAssetCandidate,
  type WorldAssetOpsCandidateRecord,
  type WorldAssetOpsFamily,
} from '@renderer/state/world-asset-ops-store.js';

export type UseImageGenerationState = {
  phase: ImageGenPhase | 'idle';
  candidates: ImageGenCandidate[];
  composedPrompt: string;
  composedNegativePrompt: string;
  error: string | null;
};

export function useImageGeneration() {
  const userId = useAppStore((state) => state.auth?.user?.id ?? '');

  const [state, setState] = useState<UseImageGenerationState>({
    phase: 'idle',
    candidates: [],
    composedPrompt: '',
    composedNegativePrompt: '',
    error: null,
  });

  const generate = useCallback(async (ctx: ImageGenEntityContext) => {
    setState((prev) => ({
      ...prev,
      phase: 'composing_prompt',
      error: null,
    }));

    try {
      const result = await generateEntityImage(ctx, (phase) => {
        setState((prev) => ({ ...prev, phase }));
      });

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: [...result.candidates, ...prev.candidates],
        composedPrompt: result.composedPrompt,
        composedNegativePrompt: result.composedNegativePrompt,
      }));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image generation failed';
      setState((prev) => ({
        ...prev,
        phase: 'failed',
        error: message,
      }));
      throw err;
    }
  }, []);

  const enqueueAgentAsset = useCallback(async (
    agentId: string,
    family: 'agent-avatar' | 'agent-cover',
    candidate: ImageGenCandidate,
  ) => {
    setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

    try {
      const uploaded = await uploadImageToCloudflare(candidate.url);
      const queuedCandidate = queueAgentAssetCandidate({
        userId,
        agentId,
        family,
        kind: 'resource',
        resourceId: uploaded.resourceId,
        previewUrl: uploaded.url,
        origin: 'image-studio',
        lifecycle: 'generated',
      });

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: prev.candidates.filter((c) => c.id !== candidate.id),
      }));

      return {
        ...uploaded,
        queuedCandidate,
      } satisfies {
        resourceId: string;
        url: string;
        queuedCandidate: AgentAssetOpsCandidateRecord;
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent asset queue failed';
      setState((prev) => ({ ...prev, phase: 'failed', error: message }));
      throw err;
    }
  }, [userId]);

  const useAsAgentAvatar = useCallback(async (agentId: string, candidate: ImageGenCandidate) => {
    return await enqueueAgentAsset(agentId, 'agent-avatar', candidate);
  }, [enqueueAgentAsset]);

  const useAsAgentCover = useCallback(async (agentId: string, candidate: ImageGenCandidate) => {
    return await enqueueAgentAsset(agentId, 'agent-cover', candidate);
  }, [enqueueAgentAsset]);

  const enqueueWorldAsset = useCallback(async (
    worldId: string,
    family: WorldAssetOpsFamily,
    candidate: ImageGenCandidate,
  ): Promise<{
    resourceId: string;
    url: string;
    queuedCandidate: WorldAssetOpsCandidateRecord;
  }> => {
    setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

    try {
      const uploaded = await uploadImageToCloudflare(candidate.url);
      const queuedCandidate = queueWorldAssetCandidate({
        userId,
        worldId,
        family,
        resourceId: uploaded.resourceId,
        previewUrl: uploaded.url,
        origin: 'image-studio',
        lifecycle: 'candidate',
      });

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: prev.candidates.filter((c) => c.id !== candidate.id),
      }));

      return {
        ...uploaded,
        queuedCandidate,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'World asset queue failed';
      setState((prev) => ({ ...prev, phase: 'failed', error: message }));
      throw err;
    }
  }, [userId]);

  const useAsWorldBanner = useCallback(async (worldId: string, candidate: ImageGenCandidate) => {
    return await enqueueWorldAsset(worldId, 'world-cover', candidate);
  }, [enqueueWorldAsset]);

  const useAsWorldIcon = useCallback(async (worldId: string, candidate: ImageGenCandidate) => {
    return await enqueueWorldAsset(worldId, 'world-icon', candidate);
  }, [enqueueWorldAsset]);

  const useAsWorldBackground = useCallback(async (worldId: string, candidate: ImageGenCandidate) => {
    return await enqueueWorldAsset(worldId, 'world-background', candidate);
  }, [enqueueWorldAsset]);

  const useAsWorldScene = useCallback(async (worldId: string, candidate: ImageGenCandidate) => {
    return await enqueueWorldAsset(worldId, 'world-scene', candidate);
  }, [enqueueWorldAsset]);

  const saveToLibrary = useCallback(async (candidate: ImageGenCandidate) => {
    setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

    try {
      const result = await uploadImageToCloudflare(candidate.url);

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: prev.candidates.filter((c) => c.id !== candidate.id),
      }));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save to library failed';
      setState((prev) => ({ ...prev, phase: 'failed', error: message }));
      throw err;
    }
  }, []);

  const removeCandidate = useCallback((candidateId: string) => {
    setState((prev) => ({
      ...prev,
      candidates: prev.candidates.filter((c) => c.id !== candidateId),
    }));
  }, []);

  const clearCandidates = useCallback(() => {
    setState((prev) => ({ ...prev, candidates: [] }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, phase: prev.phase === 'failed' ? 'idle' : prev.phase }));
  }, []);

  const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'failed';

  return {
    ...state,
    busy,
    generate,
    useAsAgentAvatar,
    useAsAgentCover,
    useAsWorldBanner,
    useAsWorldIcon,
    useAsWorldBackground,
    useAsWorldScene,
    saveToLibrary,
    removeCandidate,
    clearCandidates,
    clearError,
  };
}
