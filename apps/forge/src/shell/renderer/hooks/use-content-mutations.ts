/**
 * Forge Content Mutations (FG-CONTENT-001..007)
 */

import { useMutation } from '@tanstack/react-query';
import {
  createImageDirectUpload,
  createVideoDirectUpload,
  createAudioDirectUpload,
  createPost,
  updatePost,
  deletePost,
} from '@renderer/data/content-data-client.js';

export function useContentMutations() {
  const imageUploadMutation = useMutation({
    mutationFn: async () => await createImageDirectUpload(),
  });

  const videoUploadMutation = useMutation({
    mutationFn: async () => await createVideoDirectUpload(),
  });

  const audioUploadMutation = useMutation({
    mutationFn: async () => await createAudioDirectUpload(),
  });

  const createPostMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      await createPost(payload),
  });

  const updatePostMutation = useMutation({
    mutationFn: async (input: { postId: string; payload: Record<string, unknown> }) =>
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
    createPostMutation,
    updatePostMutation,
    deletePostMutation,
  };
}
