/**
 * useImageGeneration — React hook for entity-aware image generation.
 *
 * Wraps the image-gen-client pipeline with React state tracking,
 * candidate management, and upload-bind actions.
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ImageGenCandidate,
  ImageGenEntityContext,
  ImageGenPhase,
} from '@renderer/data/image-gen-client.js';
import {
  generateEntityImage,
  uploadAndBindAgentAvatar,
  uploadAndBindWorldBanner,
  uploadAndBindWorldIcon,
  uploadImageToCloudflare,
} from '@renderer/data/image-gen-client.js';

export type UseImageGenerationState = {
  phase: ImageGenPhase | 'idle';
  candidates: ImageGenCandidate[];
  composedPrompt: string;
  composedNegativePrompt: string;
  error: string | null;
};

export function useImageGeneration() {
  const queryClient = useQueryClient();

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

  const useAsAgentAvatar = useCallback(async (agentId: string, candidate: ImageGenCandidate) => {
    setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

    try {
      const result = await uploadAndBindAgentAvatar(agentId, candidate.url, (phase) => {
        setState((prev) => ({ ...prev, phase }));
      });

      await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'list'] });

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: prev.candidates.filter((c) => c.id !== candidate.id),
      }));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Avatar upload failed';
      setState((prev) => ({ ...prev, phase: 'failed', error: message }));
      throw err;
    }
  }, [queryClient]);

  const useAsWorldBanner = useCallback(async (worldId: string, candidate: ImageGenCandidate) => {
    setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

    try {
      const result = await uploadAndBindWorldBanner(worldId, candidate.url, (phase) => {
        setState((prev) => ({ ...prev, phase }));
      });

      await queryClient.invalidateQueries({ queryKey: ['forge', 'world'] });

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: prev.candidates.filter((c) => c.id !== candidate.id),
      }));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Banner upload failed';
      setState((prev) => ({ ...prev, phase: 'failed', error: message }));
      throw err;
    }
  }, [queryClient]);

  const useAsWorldIcon = useCallback(async (worldId: string, candidate: ImageGenCandidate) => {
    setState((prev) => ({ ...prev, phase: 'uploading', error: null }));

    try {
      const result = await uploadAndBindWorldIcon(worldId, candidate.url, (phase) => {
        setState((prev) => ({ ...prev, phase }));
      });

      await queryClient.invalidateQueries({ queryKey: ['forge', 'world'] });

      setState((prev) => ({
        ...prev,
        phase: 'done',
        candidates: prev.candidates.filter((c) => c.id !== candidate.id),
      }));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Icon upload failed';
      setState((prev) => ({ ...prev, phase: 'failed', error: message }));
      throw err;
    }
  }, [queryClient]);

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
    useAsWorldBanner,
    useAsWorldIcon,
    saveToLibrary,
    removeCandidate,
    clearCandidates,
    clearError,
  };
}
