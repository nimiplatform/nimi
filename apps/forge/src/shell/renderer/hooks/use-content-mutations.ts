/**
 * Forge Content Mutations (FG-CONTENT-001..007)
 */

import { useMutation } from '@tanstack/react-query';
import {
  createImageDirectUpload,
  createVideoDirectUpload,
  createAudioDirectUpload,
  updateMediaAsset,
  deleteMediaAsset,
  createPost,
  updatePost,
  deletePost,
  type ForgeCreateAudioDirectUploadInput,
  type ForgeCreatePostInput,
  type ForgeUpdateMediaAssetInput,
  type ForgeUpdatePostInput,
} from '@renderer/data/content-data-client.js';

export function useContentMutations() {
  const imageUploadMutation = useMutation({
    mutationFn: async (requireSignedUrls?: string) => await createImageDirectUpload(requireSignedUrls),
  });

  const videoUploadMutation = useMutation({
    mutationFn: async (requireSignedUrls?: string) => await createVideoDirectUpload(requireSignedUrls),
  });

  const audioUploadMutation = useMutation({
    mutationFn: async (payload?: ForgeCreateAudioDirectUploadInput) => await createAudioDirectUpload(payload),
  });

  const updateMediaAssetMutation = useMutation({
    mutationFn: async (input: { assetId: string; payload: ForgeUpdateMediaAssetInput }) =>
      await updateMediaAsset(input.assetId, input.payload),
  });

  const deleteMediaAssetMutation = useMutation({
    mutationFn: async (assetId: string) =>
      await deleteMediaAsset(assetId),
  });

  const createPostMutation = useMutation({
    mutationFn: async (payload: ForgeCreatePostInput) =>
      await createPost(payload),
  });

  const updatePostMutation = useMutation({
    mutationFn: async (input: { postId: string; payload: ForgeUpdatePostInput }) =>
      await updatePost(input.postId, input.payload),
  });

  const deletePostMutation = useMutation({
    mutationFn: async (postId: string) =>
      await deletePost(postId),
  });

  return {
    imageUploadMutation,
    videoUploadMutation,
    audioUploadMutation,
    updateMediaAssetMutation,
    deleteMediaAssetMutation,
    createPostMutation,
    updatePostMutation,
    deletePostMutation,
  };
}
