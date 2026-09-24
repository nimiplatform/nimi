import type {
  NimiVideoSessionClient,
  NimiVideoSessionFormat,
  NimiVideoSessionOpened,
  NimiVideoSessionResult,
  NimiVideoSessionScope,
} from '@nimiplatform/sdk/app';
import type { StudioSessionSummary } from '../../ai-studio-core/runtime-types.js';
import { t } from '../../shell/i18n/index.js';

export const LAB_VIDEO_SESSION_FORMAT: NimiVideoSessionFormat = Object.freeze({ width: 1280, height: 720, pixelFormat: 'rgb8' });
export const LAB_VIDEO_SESSION_FRAME_BYTES = 1280 * 720 * 3;
export const LAB_VIDEO_SESSION_MAX_FRAMES = 4;
// Frames are presented as a short 30 fps sequence starting at zero.
export const LAB_VIDEO_SESSION_FRAME_INTERVAL_US = 33_333;

export function labRgbaToRgb8(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  if (rgba.byteLength !== 1280 * 720 * 4) throw new Error(t('CapabilityTests.videoSession.inputPixels'));
  const rgb = new Uint8Array(LAB_VIDEO_SESSION_FRAME_BYTES);
  for (let source = 0, target = 0; source < rgba.byteLength; source += 4, target += 3) {
    rgb[target] = rgba[source]!;
    rgb[target + 1] = rgba[source + 1]!;
    rgb[target + 2] = rgba[source + 2]!;
  }
  return rgb;
}

export function labRgb8ToRgba(rgb: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  if (rgb.byteLength !== LAB_VIDEO_SESSION_FRAME_BYTES) throw new Error(t('CapabilityTests.videoSession.framePixels'));
  const rgba = new Uint8ClampedArray(1280 * 720 * 4);
  for (let source = 0, target = 0; source < rgb.byteLength; source += 3, target += 4) {
    rgba[target] = rgb[source]!;
    rgba[target + 1] = rgb[source + 1]!;
    rgba[target + 2] = rgb[source + 2]!;
    rgba[target + 3] = 255;
  }
  return rgba;
}

// Places a source image inside the fixed frame without cropping or stretching.
export function labContainRect(sourceWidth: number, sourceHeight: number): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw new Error(t('CapabilityTests.videoSession.noPixels'));
  const scale = Math.min(1280 / sourceWidth, 720 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return { x: Math.floor((1280 - width) / 2), y: Math.floor((720 - height) / 2), width, height };
}

export type LabVideoSessionFrameState = {
  readonly sequence: string;
  readonly timestampUs: string;
  // Receipt acknowledges acceptance only; it is never a transformed result.
  readonly receipt: 'pending' | 'accepted' | 'rejected';
  readonly receiptError?: string;
  readonly result?: Exclude<NimiVideoSessionResult, { readonly type: 'session-terminal' }>;
};

export type LabVideoSessionState = {
  readonly phase: 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'terminated';
  readonly scope?: NimiVideoSessionScope;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly frames: readonly LabVideoSessionFrameState[];
  readonly terminalReason?: string;
  readonly error?: string;
};

type ErrorLike = { readonly message?: unknown; readonly reasonCode?: unknown };

function describeError(error: unknown): string {
  const record = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  const message = error instanceof Error ? error.message : String(error);
  return typeof record.reasonCode === 'string' && record.reasonCode ? `${message} (${record.reasonCode})` : message;
}

export function labErrorReasonCode(error: unknown): string {
  const value = error && typeof error === 'object' ? (error as ErrorLike).reasonCode : undefined;
  return typeof value === 'string' && value ? value : 'transport-lost';
}

/**
 * One explicit video.face_swap Session: open with an App-owned reference
 * artifact, submit a few fixed-format frames in order, keep reading results
 * while open (the owner ends a Session whose results stay unread), and close.
 * No frame is written anywhere.
 */
export function createLabVideoSessionController(input: {
  readonly client: NimiVideoSessionClient;
  readonly now: () => Date;
  readonly onState: (state: LabVideoSessionState) => void;
}) {
  let state: LabVideoSessionState = { phase: 'idle', frames: [] };
  let nextSequence = 1n;
  let reading = false;
  // Close cannot cancel an Open already sent to the owner. A close requested
  // before Open returns is kept here, and the Open flow closes the Session the
  // owner returns instead of leaving it open with nobody holding it.
  let closeRequested = false;
  let pendingOpen: Promise<void> | null = null;
  let pendingClose: Promise<void> | null = null;
  const set = (patch: Partial<LabVideoSessionState>) => {
    state = { ...state, ...patch };
    input.onState(state);
  };
  const updateFrame = (sequence: string, patch: Partial<LabVideoSessionFrameState>) => {
    set({ frames: state.frames.map((frame) => frame.sequence === sequence ? { ...frame, ...patch } : frame) });
  };
  const finish = (phase: 'closed' | 'terminated', terminalReason: string, error?: string) => {
    if (state.phase === 'closed' || state.phase === 'terminated') return;
    set({ phase, terminalReason, endedAt: input.now().toISOString(), ...(error ? { error } : {}) });
  };

  const readLoop = async (scope: NimiVideoSessionScope) => {
    if (reading) return;
    reading = true;
    try {
      while (state.phase === 'open' && state.scope === scope) {
        let result: NimiVideoSessionResult | null;
        try {
          result = await input.client.read(scope);
        } catch (error) {
          if (state.phase === 'open' && state.scope === scope) finish('terminated', labErrorReasonCode(error), describeError(error));
          return;
        }
        if (!result || state.scope !== scope) continue;
        if (result.type === 'session-terminal') {
          finish('terminated', result.reasonCode);
          return;
        }
        const frame = state.frames.find((candidate) => candidate.sequence === result.sequence);
        if (frame) updateFrame(result.sequence, { result });
        else set({ frames: [...state.frames, { sequence: result.sequence, timestampUs: result.timestampUs, receipt: 'accepted', result }] });
      }
    } finally {
      reading = false;
    }
  };

  const closeScope = async (scope: NimiVideoSessionScope, reason: string) => {
    set({ phase: 'closing', scope });
    try {
      await input.client.close(scope);
      finish('closed', reason);
    } catch (error) {
      finish('terminated', labErrorReasonCode(error), describeError(error));
      throw error;
    }
  };

  const openFlow = async (referenceImageArtifactId: string) => {
    let opened: NimiVideoSessionOpened;
    try {
      opened = await input.client.open({ referenceImageArtifactId, format: LAB_VIDEO_SESSION_FORMAT });
    } catch (error) {
      finish('terminated', labErrorReasonCode(error), describeError(error));
      throw error;
    }
    const scope = { videoSessionId: opened.videoSessionId, generation: opened.generation };
    if (closeRequested) {
      // A failed close is already recorded in the terminal state.
      await closeScope(scope, 'closed-during-open').catch(() => undefined);
      return;
    }
    set({ phase: 'open', scope });
    void readLoop(scope);
  };

  return {
    getState: () => state,
    async open(referenceImageArtifactId: string): Promise<void> {
      // Closed before Open was sent (for example while the reference uploaded):
      // the owner is never contacted.
      if (state.phase === 'closed' && state.terminalReason === 'closed-before-open') return;
      if (state.phase !== 'idle') throw new Error(t('CapabilityTests.videoSession.alreadyUsed'));
      set({ phase: 'opening', startedAt: input.now().toISOString() });
      pendingOpen = openFlow(referenceImageArtifactId);
      try {
        await pendingOpen;
      } finally {
        pendingOpen = null;
      }
    },
    // Frames go one at a time: the next submission waits for the previous receipt.
    async submit(frame: Uint8Array): Promise<void> {
      const scope = state.scope;
      if (state.phase !== 'open' || !scope) throw new Error(t('CapabilityTests.videoSession.notOpen'));
      if (state.frames.length >= LAB_VIDEO_SESSION_MAX_FRAMES) throw new Error(t('CapabilityTests.videoSession.frameLimit', { max: LAB_VIDEO_SESSION_MAX_FRAMES }));
      const sequence = String(nextSequence);
      const timestampUs = String((nextSequence - 1n) * BigInt(LAB_VIDEO_SESSION_FRAME_INTERVAL_US));
      nextSequence += 1n;
      set({ frames: [...state.frames, { sequence, timestampUs, receipt: 'pending' }] });
      try {
        await input.client.submitFrame({ ...scope, sequence, timestampUs, frame });
        updateFrame(sequence, { receipt: 'accepted' });
      } catch (error) {
        updateFrame(sequence, { receipt: 'rejected', receiptError: describeError(error) });
        throw error;
      }
    },
    // While Open is pending this resolves once the returned Session is closed.
    async close(): Promise<void> {
      if (pendingClose) return pendingClose;
      if (state.phase === 'closed' || state.phase === 'terminated') return;
      closeRequested = true;
      if (state.phase === 'opening' && pendingOpen) {
        set({ phase: 'closing' });
        pendingClose = pendingOpen.then(() => undefined, () => undefined);
      } else if (state.scope) {
        pendingClose = closeScope(state.scope, 'closed-by-user');
      } else {
        finish('closed', 'closed-before-open');
        return;
      }
      return pendingClose;
    },
  };
}

export type LabVideoSessionController = ReturnType<typeof createLabVideoSessionController>;

export function labVideoSessionSummary(state: LabVideoSessionState): StudioSessionSummary {
  const observed: Record<string, number> = {
    submitted: state.frames.length,
    accepted: state.frames.filter((frame) => frame.receipt === 'accepted').length,
    'submit-rejected': state.frames.filter((frame) => frame.receipt === 'rejected').length,
    transformed: 0,
    'no-target-face': 0,
    'input-dropped': 0,
    'input-rejected': 0,
  };
  for (const frame of state.frames) {
    if (frame.result) observed[frame.result.type] = (observed[frame.result.type] ?? 0) + 1;
  }
  return {
    capabilityContract: 'video.face_swap',
    startedAt: state.startedAt ?? new Date(0).toISOString(),
    endedAt: state.endedAt ?? state.startedAt ?? new Date(0).toISOString(),
    ending: state.phase === 'closed' ? 'closed' : 'terminated',
    terminalReason: state.terminalReason ?? 'unknown',
    observed,
  };
}
