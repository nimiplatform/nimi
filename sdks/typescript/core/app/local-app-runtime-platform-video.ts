import { base64decode, base64encode } from '@protobuf-ts/runtime';
import type { JsonValue } from '../../types';
import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation.js';

export type NimiVideoSessionScope = { readonly videoSessionId: string; readonly generation: string };
export type NimiVideoSessionFormat = { readonly width: 1280; readonly height: 720; readonly pixelFormat: 'rgb8' };
export type NimiVideoSessionOpened = NimiVideoSessionScope & { readonly format: NimiVideoSessionFormat; readonly maximumInFlightSubmissions: 2 };
export type NimiVideoSessionResult = NimiVideoSessionScope & (
  | { readonly type: 'transformed'; readonly sequence: string; readonly timestampUs: string; readonly frame: Uint8Array }
  | { readonly type: 'no-target-face' | 'input-dropped' | 'input-rejected'; readonly sequence: string; readonly timestampUs: string; readonly reasonCode: string }
  | { readonly type: 'session-terminal'; readonly reasonCode: string }
);
export type NimiVideoSessionClient = {
  readonly open: (input: { readonly referenceImageArtifactId: string; readonly format: NimiVideoSessionFormat }) => Promise<NimiVideoSessionOpened>;
  readonly submitFrame: (input: NimiVideoSessionScope & { readonly sequence: string; readonly timestampUs: string; readonly frame: Uint8Array }) => Promise<{ readonly accepted: true; readonly sequence: string }>;
  readonly read: (input: NimiVideoSessionScope) => Promise<NimiVideoSessionResult | null>;
  readonly close: (input: NimiVideoSessionScope) => Promise<{ readonly closed: true }>;
};
type ShellInput = { readonly [key: string]: JsonValue };
export type NimiVideoSessionShell = {
  readonly open: (input: ShellInput) => Promise<unknown>;
  readonly submitFrame: (input: ShellInput) => Promise<unknown>;
  readonly read: (input: ShellInput) => Promise<unknown>;
  readonly close: (input: ShellInput) => Promise<unknown>;
};

const FRAME_BYTES = 1280 * 720 * 3;
function encodeFrame(frame: Uint8Array): string {
  const native = (frame as Uint8Array & { toBase64?: () => string }).toBase64;
  return native ? native.call(frame) : base64encode(frame);
}
function decodeFrame(value: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array }).fromBase64;
  return native ? native(value) : base64decode(value);
}
function invalid(field: string): never { return localAppError(`Video Session input is invalid: ${field}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_exact_video_session_input'); }
function decimal(value: unknown, zero = false): string {
  if (typeof value !== 'string' || !(zero ? /^(0|[1-9][0-9]{0,19})$/u : /^[1-9][0-9]{0,19}$/u).test(value) || BigInt(value) > 18446744073709551615n) invalid('unsigned integer');
  return value;
}
function identifier(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 128 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) invalid('identifier'); return value; }
function scope(input: NimiVideoSessionScope): NimiVideoSessionScope { return { videoSessionId: identifier(input.videoSessionId), generation: decimal(input.generation) }; }
function format(value: unknown): NimiVideoSessionFormat {
  const record = asRecord(value);
  assertExactKeys(record, ['width', 'height', 'pixelFormat'], 'video format');
  if (record.width !== 1280 || record.height !== 720 || record.pixelFormat !== 'rgb8') invalid('format');
  return Object.freeze({ width: 1280, height: 720, pixelFormat: 'rgb8' });
}

// @nimi-authority: rule.nimi.sdks.feature-clients.face-swap-video-session
export function createNimiVideoSessionClient(shell: NimiVideoSessionShell): NimiVideoSessionClient {
  type State = { pending: number; reading: boolean; closed: boolean; waits: Set<() => void> };
  const states = new Map<string, State>();
  const stateFor = (value: NimiVideoSessionScope) => {
    const key = `${value.videoSessionId}:${value.generation}`;
    let state = states.get(key);
    if (!state) { state = { pending: 0, reading: false, closed: false, waits: new Set() }; states.set(key, state); }
    return state;
  };
  const unavailable = () => localAppError('Video Session is closed or its transport was lost.', 'SDK_LOCAL_APP_OPERATION_UNAVAILABLE', 'open_a_new_video_session');
  const overloaded = () => localAppError('Video Session has reached its unfinished-call bound.', 'AI_VIDEO_SESSION_OVERLOADED', 'wait_for_video_session_capacity');
  const stop = (state: State) => {
    state.closed = true;
    for (const finish of state.waits) finish();
    state.waits.clear();
  };
  const whileOpen = async <T>(state: State, operation: () => Promise<T>): Promise<T> => {
    let finish!: () => void;
    const ended = new Promise<void>(resolve => { finish = resolve; });
    state.waits.add(finish);
    try { return await Promise.race([operation(), ended.then(unavailable)]); }
    finally { state.waits.delete(finish); }
  };
  return Object.freeze({
    open: async (input) => {
      assertExactKeys(input, ['referenceImageArtifactId', 'format'], 'video Session open');
      const requested = format(input.format);
      const value = asRecord(await shell.open({ referenceImageArtifactId: identifier(input.referenceImageArtifactId), ...requested }));
      assertExactProjectionKeys(value, ['videoSessionId', 'generation', 'format', 'maximumInFlightSubmissions'], 'video Session open');
      if (value.maximumInFlightSubmissions !== 2) localAppProjectionError('video Session submission bound');
      const selected = scope(value as NimiVideoSessionScope);
      stateFor(selected);
      return Object.freeze({ ...selected, format: format(value.format), maximumInFlightSubmissions: 2 as const });
    },
    submitFrame: async (input) => {
      assertExactKeys(input, ['videoSessionId', 'generation', 'sequence', 'timestampUs', 'frame'], 'video frame');
      const selected = scope(input), sequence = decimal(input.sequence), timestampUs = decimal(input.timestampUs, true);
      if (!(input.frame instanceof Uint8Array) || input.frame.byteLength !== FRAME_BYTES) invalid('frame size');
      const state = stateFor(selected);
      if (state.closed) return unavailable();
      if (state.pending >= 2) return overloaded();
      state.pending++;
      try {
        const response = asRecord(await whileOpen(state, () => shell.submitFrame({ ...selected, sequence, timestampUs, frameBase64: encodeFrame(input.frame) })));
        assertExactProjectionKeys(response, ['accepted', 'sequence'], 'video frame receipt');
        if (response.accepted !== true || response.sequence !== sequence) localAppProjectionError('video frame receipt');
        return Object.freeze({ accepted: true as const, sequence });
      } catch (error) {
        const reason = String((error as { reasonCode?: unknown })?.reasonCode ?? '').toLowerCase().replaceAll('_', '-');
        if (!['ai-input-invalid', 'ai-media-option-unsupported', 'ai-video-session-generation-invalid', 'protocol-envelope-invalid'].includes(reason)) stop(state);
        throw error;
      } finally { state.pending--; }
    },
    read: async (input) => {
      assertExactKeys(input, ['videoSessionId', 'generation'], 'video result read');
      const selected = scope(input), state = stateFor(selected);
      if (state.closed) return unavailable();
      if (state.reading) return overloaded();
      state.reading = true;
      try {
        const response = asRecord(await whileOpen(state, () => shell.read(selected)));
        assertExactProjectionKeys(response, ['result'], 'video result response');
        if (response.result === null) return null;
        const record = asRecord(response.result);
        const terminal = record?.type === 'session-terminal';
        const transformed = record?.type === 'transformed';
        assertExactProjectionKeys(record, ['videoSessionId', 'generation', 'type', ...(terminal ? [] : ['sequence', 'timestampUs']), ...(transformed ? ['frameBase64'] : ['reasonCode'])], 'video result');
        if (record.videoSessionId !== selected.videoSessionId || record.generation !== selected.generation) localAppProjectionError('video result scope');
        if (terminal) {
          stop(state);
          return Object.freeze({ ...selected, type: 'session-terminal', reasonCode: identifier(record.reasonCode) });
        }
        const sequence = decimal(record.sequence), timestampUs = decimal(record.timestampUs, true);
        if (transformed) {
          if (typeof record.frameBase64 !== 'string' || record.frameBase64.length !== FRAME_BYTES / 3 * 4) localAppProjectionError('video frame bytes');
          const frame = decodeFrame(record.frameBase64);
          if (frame.byteLength !== FRAME_BYTES) localAppProjectionError('video frame bytes');
          return Object.freeze({ ...selected, type: 'transformed', sequence, timestampUs, frame });
        }
        if (!['no-target-face', 'input-dropped', 'input-rejected'].includes(String(record.type))) localAppProjectionError('video result variant');
        return Object.freeze({ ...selected, type: record.type as 'no-target-face' | 'input-dropped' | 'input-rejected', sequence, timestampUs, reasonCode: identifier(record.reasonCode) });
      } catch (error) { stop(state); throw error; }
      finally { state.reading = false; }
    },
    close: async (input) => {
      assertExactKeys(input, ['videoSessionId', 'generation'], 'video Session close');
      const selected = scope(input), state = stateFor(selected);
      stop(state);
      const response = asRecord(await shell.close(selected));
      assertExactProjectionKeys(response, ['closed'], 'video Session close');
      if (response.closed !== true) localAppProjectionError('video Session close');
      return Object.freeze({ closed: true as const });
    },
  });
}
