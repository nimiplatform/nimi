import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFinalizeResource = vi.fn();

vi.mock('@renderer/data/content-data-client.js', () => ({
  finalizeResource: mockFinalizeResource,
}));

const videoStudioPage = await import('./video-studio-page.js');

describe('video-studio-page upload finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finalizes uploaded video resources through the Resources API', async () => {
    mockFinalizeResource.mockResolvedValue({
      url: 'https://cdn.example.com/video.mp4',
    });

    const previewUrl = await videoStudioPage.finalizeUploadedVideoResource({
      resourceId: 'resource-video-1',
      mimeType: 'video/mp4',
    });

    expect(mockFinalizeResource).toHaveBeenCalledWith('resource-video-1', {
      mimeType: 'video/mp4',
    });
    expect(previewUrl).toBe('https://cdn.example.com/video.mp4');
  });

  it('fails closed when uploaded video finalization fails', async () => {
    mockFinalizeResource.mockRejectedValue(new Error('finalize failed'));

    await expect(videoStudioPage.finalizeUploadedVideoResource({
      resourceId: 'resource-video-1',
      mimeType: 'video/mp4',
    })).rejects.toThrow('finalize failed');
  });
});
