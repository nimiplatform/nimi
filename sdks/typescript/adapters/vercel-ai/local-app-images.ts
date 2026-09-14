import type { NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import type { NimiLocalAppAIConsumptionClient, NimiLocalAppArtifactUploadMime } from '@nimiplatform/sdk/app';
import type { NimiMessage, NimiMessagePart } from '@nimiplatform/sdk/contracts';
import { createNimiError } from '@nimiplatform/sdk';

function invalid(message: string): never {
  throw createNimiError({ code: 'SDK_ADAPTER_INPUT_INVALID', reasonCode: 'SDK_ADAPTER_INPUT_INVALID', message, actionHint: 'provide_supported_image_content', source: 'sdk' });
}

// File bytes are uploaded explicitly through the same protected App client.
// Only transport base64 is decoded here; Runtime owns image interpretation.
export async function prepareLocalAppImages(request: NimiGenerateTextRequest, ai: NimiLocalAppAIConsumptionClient): Promise<NimiGenerateTextRequest> {
  const messages: NimiMessage[] = [];
  for (const message of request.messages) {
    const content: NimiMessagePart[] = [];
    for (const part of message.content) {
      request.signal?.throwIfAborted();
      if (part.type !== 'file' || /^https?:\/\//i.test(part.data)) {
        content.push(part);
        continue;
      }
      if (message.role !== 'user' || !part.mediaType.startsWith('image/')) invalid('Local App framework uploads require a user image.');
      let encoded = part.data;
      if (encoded.startsWith('data:')) {
        const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]*)$/.exec(encoded);
        if (!match || match[1] !== part.mediaType) invalid('Image data URL does not match its declared media type.');
        encoded = match[2]!;
      }
      let binary: string;
      try { binary = atob(encoded); } catch { return invalid('Image content must be a URL or base64 file data.'); }
      if (!binary.length) invalid('Image content is empty.');
      const uploaded = await ai.artifacts.upload({ bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), mimeType: part.mediaType as NimiLocalAppArtifactUploadMime });
      request.signal?.throwIfAborted();
      content.push({ type: 'artifact-ref', artifactId: uploaded.artifactId, mediaType: uploaded.mimeType, ...(part.filename ? { displayName: part.filename } : {}) });
    }
    messages.push({ ...message, content });
  }
  return { ...request, messages };
}
