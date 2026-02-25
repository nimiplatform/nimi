export class SpeechAssetStore {
  private readonly objectUrls = new Set<string>();

  register(audioUri: string): string {
    const normalized = String(audioUri || '').trim();
    if (!normalized) {
      throw new Error('SPEECH_OUTPUT_INVALID: empty audioUri');
    }
    if (normalized.startsWith('blob:')) {
      this.objectUrls.add(normalized);
    }
    return normalized;
  }

  revoke(audioUri: string): void {
    const normalized = String(audioUri || '').trim();
    if (!normalized.startsWith('blob:')) return;
    if (!this.objectUrls.has(normalized)) return;
    URL.revokeObjectURL(normalized);
    this.objectUrls.delete(normalized);
  }

  revokeAll(): void {
    for (const uri of this.objectUrls) {
      URL.revokeObjectURL(uri);
    }
    this.objectUrls.clear();
  }
}

