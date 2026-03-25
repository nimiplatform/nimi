/**
 * Forge Content Mutations (FG-CONTENT-001..007)
 */

import { useMutation } from '@tanstack/react-query';
import {
  createImageDirectUpload,
  createVideoDirectUpload,
  createAudioDirectUpload,
  updateResource,
  deleteResource,
  createPost,
  updatePost,
  deletePost,
  type ForgeCreateAudioDirectUploadInput,
  type ForgeCreatePostInput,
  type ForgeUpdateResourceInput,
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

  const updateResourceMutation = useMutation({
    mutationFn: async (input: { resourceId: string; payload: ForgeUpdateResourceInput }) =>
      await updateResource(input.resourceId, input.payload),
  });

  const deleteResourceMutation = useMutation({
    mutationFn: async (resourceId: string) =>
      await deleteResource(resourceId),
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
    updateResourceMutation,
    deleteResourceMutation,
    createPostMutation,
    updatePostMutation,
    deletePostMutation,
  };
}
