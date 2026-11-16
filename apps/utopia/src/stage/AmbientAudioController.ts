import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export type ActiveAudioTrackSpec = Readonly<{
  readonly id: string;
  readonly url: string;
  readonly gain: number;
}>;

type RunningSlot = {
  readonly id: string;
  readonly url: string;
  readonly source: AudioBufferSourceNode;
  readonly gainNode: GainNode;
};

const CROSSFADE_SECONDS = 1.2;
const AUDIO_VOLUME_STORAGE_KEY = 'nimi.utopia.audio-volume.v1';
const DEFAULT_USER_VOLUME = 0.72;

export function readSavedAudioVolume(): number {
  const storage = resolveBrowserStorage('local');
  const read = readStorageJsonFrom<number>(storage, AUDIO_VOLUME_STORAGE_KEY, (raw) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_USER_VOLUME;
    return Math.max(0.05, Math.min(1, raw));
  });
  return read.state === 'ready' ? read.value : DEFAULT_USER_VOLUME;
}

export class AmbientAudioController {
  private ctx: AudioContext | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private currentSlot: RunningSlot | null = null;
  private muted = true;
  private userVolume = readSavedAudioVolume();
  private suspendedByHost = false;
  private desiredTrack: ActiveAudioTrackSpec | null = null;
  private transitionSeq = 0;

  isMuted(): boolean {
    return this.muted;
  }

  getVolume(): number {
    return this.userVolume;
  }

  setVolume(nextVolume: number): void {
    if (!Number.isFinite(nextVolume)) return;
    const clamped = Math.max(0.05, Math.min(1, nextVolume));
    this.userVolume = clamped;
    writeStorageJsonTo(resolveBrowserStorage('local'), AUDIO_VOLUME_STORAGE_KEY, clamped);
    if (!this.muted && !this.suspendedByHost && this.currentSlot && this.ctx && this.desiredTrack) {
      const now = this.ctx.currentTime;
      const effectiveGain = this.effectiveGain(this.desiredTrack.gain);
      this.currentSlot.gainNode.gain.cancelScheduledValues(now);
      this.currentSlot.gainNode.gain.setValueAtTime(this.currentSlot.gainNode.gain.value, now);
      this.currentSlot.gainNode.gain.linearRampToValueAtTime(effectiveGain, now + 0.12);
    }
  }

  async setMuted(nextMuted: boolean): Promise<void> {
    if (this.muted === nextMuted) return;
    this.muted = nextMuted;
    if (nextMuted) {
      this.fadeOutCurrent(0.35);
      return;
    }
    await this.ensureContextReady();
    await this.syncPlayback();
  }

  async setHostSuspended(suspended: boolean): Promise<void> {
    if (this.suspendedByHost === suspended) return;
    this.suspendedByHost = suspended;
    if (suspended) {
      this.fadeOutCurrent(0.25);
      if (this.ctx && this.ctx.state === 'running') {
        await this.ctx.suspend().catch(() => undefined);
      }
      return;
    }
    if (!this.muted) {
      await this.ensureContextReady();
      await this.syncPlayback();
    }
  }

  async setTrack(track: ActiveAudioTrackSpec | null): Promise<void> {
    const prev = this.desiredTrack;
    this.desiredTrack = track;
    if (prev?.id === track?.id && prev?.url === track?.url && prev?.gain === track?.gain) {
      return;
    }
    if (this.muted || this.suspendedByHost) return;
    await this.syncPlayback();
  }

  async dispose(): Promise<void> {
    this.transitionSeq += 1;
    this.stopSlotImmediate(this.currentSlot);
    this.currentSlot = null;
    this.bufferCache.clear();
    if (this.ctx) {
      const closing = this.ctx;
      this.ctx = null;
      await closing.close().catch(() => undefined);
    }
  }

  private effectiveGain(trackGain: number): number {
    return Math.max(0.001, Math.min(0.85, trackGain * this.userVolume * 1.45));
  }

  private async ensureContextReady(): Promise<AudioContext | null> {
    if (typeof globalThis.AudioContext !== 'function') return null;
    if (!this.ctx) {
      this.ctx = new globalThis.AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private async loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new Error(`Audio asset load failed: ${url}`);
    }
    const arrayBuf = await response.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    this.bufferCache.set(url, decoded);
    return decoded;
  }

  private async syncPlayback(): Promise<void> {
    const seq = ++this.transitionSeq;
    const target = this.desiredTrack;
    if (!target || this.muted || this.suspendedByHost) {
      this.fadeOutCurrent(0.4);
      return;
    }

    const ctx = await this.ensureContextReady();
    if (!ctx || seq !== this.transitionSeq) return;
    const targetGain = this.effectiveGain(target.gain);

    if (this.currentSlot && this.currentSlot.url === target.url) {
      const now = ctx.currentTime;
      this.currentSlot.gainNode.gain.cancelScheduledValues(now);
      this.currentSlot.gainNode.gain.setValueAtTime(this.currentSlot.gainNode.gain.value, now);
      this.currentSlot.gainNode.gain.linearRampToValueAtTime(targetGain, now + CROSSFADE_SECONDS);
      return;
    }

    let buffer: AudioBuffer;
    try {
      buffer = await this.loadBuffer(ctx, target.url);
    } catch {
      return;
    }
    if (seq !== this.transitionSeq || this.muted || this.suspendedByHost) return;

    const prevSlot = this.currentSlot;
    const now = ctx.currentTime;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(targetGain, now + CROSSFADE_SECONDS);

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(now);

    this.currentSlot = { id: target.id, url: target.url, source, gainNode };

    if (prevSlot) {
      prevSlot.gainNode.gain.cancelScheduledValues(now);
      prevSlot.gainNode.gain.setValueAtTime(prevSlot.gainNode.gain.value, now);
      prevSlot.gainNode.gain.linearRampToValueAtTime(0.0001, now + CROSSFADE_SECONDS);
      globalThis.setTimeout(() => {
        this.stopSlotImmediate(prevSlot);
      }, Math.ceil(CROSSFADE_SECONDS * 1000) + 80);
    }
  }

  private fadeOutCurrent(seconds: number): void {
    const slot = this.currentSlot;
    this.currentSlot = null;
    if (!slot || !this.ctx) {
      this.stopSlotImmediate(slot);
      return;
    }
    const now = this.ctx.currentTime;
    slot.gainNode.gain.cancelScheduledValues(now);
    slot.gainNode.gain.setValueAtTime(slot.gainNode.gain.value, now);
    slot.gainNode.gain.linearRampToValueAtTime(0.0001, now + seconds);
    globalThis.setTimeout(() => {
      this.stopSlotImmediate(slot);
    }, Math.ceil(seconds * 1000) + 60);
  }

  private stopSlotImmediate(slot: RunningSlot | null): void {
    if (!slot) return;
    try {
      slot.source.stop();
    } catch {
      // Ignore already stopped source
    }
    try {
      slot.source.disconnect();
      slot.gainNode.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}
