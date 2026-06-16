import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_DATA_URL_ATTACHMENT_ACCEPT,
  browserDataUrlAttachmentsToNimiMessages,
  browserFilesToDataUrlAttachments,
  createBrowserDataUrlAttachmentAdapter,
} from '../src/headless.js';

describe('browser data-url attachment adapter', () => {
  it('reads accepted image and video files as data-url attachments', async () => {
    const image = new File(['image-bytes'], 'screen.png', { type: 'image/png' });
    const video = new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' });
    const ignored = new File(['text'], 'notes.txt', { type: 'text/plain' });

    const attachments = await browserFilesToDataUrlAttachments([image, video, ignored], {
      idFactory: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `attachment-${index}`;
        };
      })(),
    });

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      id: 'attachment-1',
      kind: 'image',
      name: 'screen.png',
      mimeType: 'image/png',
    });
    expect(attachments[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(attachments[1]).toMatchObject({
      id: 'attachment-2',
      kind: 'video',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
    });
    expect(attachments[1]?.dataUrl).toMatch(/^data:video\/mp4;base64,/);
  });

  it('exposes picker metadata and merge semantics for chat composer slots', () => {
    const adapter = createBrowserDataUrlAttachmentAdapter();
    const attachment = {
      id: 'a1',
      kind: 'image' as const,
      name: 'screen.png',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      mimeType: 'image/png',
    };

    expect(DEFAULT_BROWSER_DATA_URL_ATTACHMENT_ACCEPT).toContain('image/png');
    expect(DEFAULT_BROWSER_DATA_URL_ATTACHMENT_ACCEPT).toContain('video/mp4');
    expect(adapter.mergeAttachments?.([], [attachment])).toEqual([attachment]);
    expect(adapter.getKey?.(attachment, 0)).toBe('a1');
    expect(adapter.getLabel?.(attachment, 0)).toBe('screen.png');
    expect(adapter.getSecondaryLabel?.(attachment, 0)).toBe('image/png');
    expect(adapter.getPreviewUrl?.(attachment, 0)).toBe(attachment.dataUrl);
    expect(adapter.getKind?.(attachment, 0)).toBe('image');
  });

  it('projects attachments into vNext Nimi message data parts', () => {
    const payload = browserDataUrlAttachmentsToNimiMessages('Describe this', [{
      id: 'a1',
      kind: 'image',
      name: 'screen.png',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      mimeType: 'image/png',
    }]);

    expect(Array.isArray(payload)).toBe(true);
    expect(JSON.stringify(payload)).toContain('screen.png');
    expect(JSON.stringify(payload)).toContain('Describe this');
  });
});
