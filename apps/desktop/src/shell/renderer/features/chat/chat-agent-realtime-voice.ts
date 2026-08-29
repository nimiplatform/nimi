import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types.js';
import type { NimiAgentRealtimeClient, NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createNimiError } from '@nimiplatform/sdk/types';

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
// The protected Electron carrier is unary per frame. A negotiated 100 ms PCM
// frame keeps capture at 10 bounded operations/second while preserving the
// provider's exact 16 kHz mono contract and server-VAD continuity.
const FRAME_SAMPLES = 1_600;
const FRAME_BYTES = FRAME_SAMPLES * 2;
const MAX_QUEUED_FRAMES = 32;

type AgentRealtimeVoiceCallbacks = {
  readonly onAmplitude: (value: number) => void;
  readonly onTranscript: (text: string, final: boolean) => void;
  readonly onOutputActive: (active: boolean) => void;
  readonly onClosed: () => void;
  readonly onError: (error: unknown) => void;
};

export type DesktopAgentRealtimeVoiceSession = {
  readonly finishInput: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

export async function interruptAgentRealtimeOutputBeforeClose(input: {
  readonly outputTrackId: string;
  readonly outputTerminal: boolean;
  readonly interruptAgentTurn: boolean;
  readonly stopPlayback: () => void;
  readonly interruptOutput: (outputTrackId: string, interruptAgentTurn: boolean) => Promise<void>;
  readonly close: () => Promise<void>;
}): Promise<void> {
  let firstError: unknown = null;
  if (input.outputTrackId) {
    input.stopPlayback();
    if (!input.outputTerminal) {
      try {
        await input.interruptOutput(input.outputTrackId, input.interruptAgentTurn);
      } catch (error) {
        firstError = error;
      }
    }
  }
  try {
    await input.close();
  } catch (error) {
    firstError ||= error;
  }
  if (firstError) throw firstError;
}

export function createAgentRealtimeTerminalError(reasonCode: string) {
  const normalizedReasonCode = reasonCode.trim() || 'AI_REALTIME_SESSION_CLOSED';
  return createNimiError({
    message: `Agent Realtime closed (${normalizedReasonCode}).`,
    reasonCode: normalizedReasonCode,
    actionHint: normalizedReasonCode === 'AI_VOICE_INPUT_INVALID'
      ? 'retry_voice_input'
      : 'inspect_agent_realtime_voice',
    source: 'runtime',
  });
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r034
export async function startDesktopAgentRealtimeVoice(input: {
  readonly client: NimiAgentRealtimeClient;
  readonly target: AgentLocalTargetSnapshot;
  readonly conversationAnchorId: string;
  readonly callbacks: AgentRealtimeVoiceCallbacks;
}): Promise<DesktopAgentRealtimeVoiceSession> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    throw new Error('Realtime microphone capture is unavailable on this device.');
  }
  const client = input.client;
  const agentHandle = resolveAgentHandle(input.target);
  const media = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let microphone: MediaStreamAudioSourceNode | null = null;
  let silentGain: GainNode | null = null;
  let closed = false;
  let inputFinished = false;
	let opened: Awaited<ReturnType<typeof client.open>> | null = null;
  const abortController = new AbortController();
  const playbackSources = new Set<AudioBufferSourceNode>();
  let playbackCursor = 0;
  let activeOutputTrackId = '';
  let providerOutputActive = false;
  let turnTerminal = false;
  let playbackReferenceRms = 0;
  let bargeSpeechFrames = 0;
  let bargeInPending = false;
  let outputTeardownPending = false;
  let queuedFrames = 0;
  let sendChain = Promise.resolve();
  let inputSequence = 0;
  const inputTrackId = `input_${crypto.randomUUID()}`;
  const utteranceId = `utterance_${crypto.randomUUID()}`;
  let primaryResampler: ReturnType<typeof createPcm16Resampler> | null = null;

  const stopCapture = async () => {
    if (processor) processor.onaudioprocess = null;
    processor?.disconnect();
    microphone?.disconnect();
    silentGain?.disconnect();
    processor = null;
    microphone = null;
    silentGain = null;
    media.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    input.callbacks.onAmplitude(0);
  };

  const stopMedia = async () => {
    await stopCapture();
    for (const source of playbackSources) {
      try { source.stop(); } catch { /* already terminal */ }
      source.disconnect();
    }
    playbackSources.clear();
    if (audioContext) {
      const current = audioContext;
      audioContext = null;
      await current.close().catch(() => undefined);
    }
  };

  const stopPlayback = () => {
    for (const source of playbackSources) {
      try { source.stop(); } catch { /* already terminal */ }
      source.disconnect();
    }
    playbackSources.clear();
    playbackCursor = audioContext?.currentTime || 0;
    activeOutputTrackId = '';
    providerOutputActive = false;
    playbackReferenceRms = 0;
    input.callbacks.onOutputActive(false);
  };

  const maybeCloseAfterPlayback = () => {
    if (turnTerminal && !providerOutputActive && playbackSources.size === 0 && !closed && !outputTeardownPending) {
      void close('turn-terminal');
    }
  };

  const close = async (reason = 'owner-close', propagateRemoteError = false) => {
    if (closed) return;
    const abnormalClose = [
      'input-device-ended',
      'input-backpressure',
      'input-append-failed',
	  'capture-stop-failed',
      'event-stream-failed',
      'open-failed',
      'barge-in-failed',
    ].includes(reason);
    logRendererEvent({
      level: abnormalClose ? 'warn' : 'info',
      area: 'agent-realtime-voice',
      message: 'lifecycle:close',
      details: {
        reason,
        inputFinished,
        providerOutputActive,
        queuedFrames,
        playbackSources: playbackSources.size,
      },
    });
    closed = true;
    abortController.abort();
    await stopMedia();
    const current = opened;
    opened = null;
    let remoteCloseError: unknown = null;
    if (current) {
	  await client.close({
        realtimeSessionId: current.realtimeSessionId,
        generation: current.generation,
        agentHandle: resolveAgentHandle(input.target),
      }).catch((error) => { remoteCloseError = error; });
    }
    input.callbacks.onAmplitude(0);
    input.callbacks.onOutputActive(false);
    input.callbacks.onClosed();
    if (propagateRemoteError && remoteCloseError) throw remoteCloseError;
  };

  const interruptCurrentOutputAndClose = async (reason: 'owner-stop' | 'barge-in' | 'event-stream-failed') => {
    if (closed || outputTeardownPending) return;
    outputTeardownPending = true;
    const current = opened;
    const outputTrackId = activeOutputTrackId;
    // The Agent turn remains active until its typed terminal is observed. An
    // output track can finish before the request terminal reaches this
    // consumer, so provider playback state alone cannot release the turn.
    const interruptAgentTurn = !turnTerminal;
    await interruptAgentRealtimeOutputBeforeClose({
      outputTrackId,
      outputTerminal: turnTerminal,
      interruptAgentTurn,
      stopPlayback,
      interruptOutput: async (trackID, shouldInterruptAgentTurn) => {
        if (!current || closed) return;
        await client.interruptOutput({
          realtimeSessionId: current.realtimeSessionId,
          generation: current.generation,
          outputTrackId: trackID,
          interruptAgentTurn: shouldInterruptAgentTurn,
          agentHandle,
        });
      },
      close: () => close(reason, true),
    });
  };

  const queueAudioFrame = (frame: Uint8Array, trackId: string, currentUtteranceId: string, frameSequence: number) => {
	if (closed || !opened) return;
	queuedFrames += 1;
	if (queuedFrames > MAX_QUEUED_FRAMES) {
		void close('input-backpressure').then(() => input.callbacks.onError(new Error('Realtime microphone backpressure limit reached.')));
		return;
	}
	const session = opened;
	sendChain = sendChain.then(async () => {
		if (closed) return;
		await client.appendInput({
			realtimeSessionId: session.realtimeSessionId,
			generation: session.generation,
			agentHandle,
			input: { type: 'audio-frame', inputTrackId: trackId, utteranceId: currentUtteranceId, frameSequence: String(frameSequence), frame },
		});
	}).catch((error) => {
		if (!closed) void close('input-append-failed').then(() => input.callbacks.onError(error));
	}).finally(() => {
		queuedFrames = Math.max(0, queuedFrames - 1);
	});
  };

  const finishInput = async () => {
    if (closed || inputFinished || !opened) return;
    inputFinished = true;
    const current = opened;
	for (const frame of primaryResampler?.flush() || []) {
		inputSequence += 1;
		queueAudioFrame(frame, inputTrackId, utteranceId, inputSequence);
	}
    await sendChain;
    if (closed || opened !== current) return;
	try {
		await client.appendInput({
			realtimeSessionId: current.realtimeSessionId,
			generation: current.generation,
			agentHandle,
			input: { type: 'capture-stopped', inputTrackId, utteranceId },
		});
	} catch (error) {
		await close('capture-stop-failed');
		throw error;
	}
  };

  try {
	opened = await client.open({
      agentHandle,
      conversationAnchorId: input.conversationAnchorId,
      inputAudio: {
		codec: 'pcm-s16le',
        sampleRateHz: INPUT_SAMPLE_RATE,
        channelCount: 1,
        frameDurationMs: 100,
        maximumFrameBytes: FRAME_BYTES,
      },
	  turnDetection: 'manual',
    });
    if (!opened.realtimeSessionId || !opened.generation
      || opened.negotiatedInputAudio?.sampleRateHz !== INPUT_SAMPLE_RATE
      || opened.negotiatedOutputAudio?.sampleRateHz !== OUTPUT_SAMPLE_RATE) {
      throw new Error('Runtime negotiated an unsupported Realtime audio contract.');
    }

    audioContext = new AudioContext({ latencyHint: 'interactive' });
    await audioContext.resume();
    microphone = audioContext.createMediaStreamSource(media);
    const inputDevice = media.getAudioTracks()[0];
    if (!inputDevice) {
      throw new Error('Realtime microphone input device is unavailable.');
    }
    inputDevice.onended = () => {
      if (!closed) {
        void close('input-device-ended').then(() => input.callbacks.onError(new Error('Realtime microphone input device was disconnected.')));
      }
    };
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    microphone.connect(processor);

	primaryResampler = createPcm16Resampler(audioContext.sampleRate, INPUT_SAMPLE_RATE);
    processor.onaudioprocess = (event) => {
      if (closed || !opened) return;
      const samples = event.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index] || 0));
      input.callbacks.onAmplitude(Math.min(1, peak * 2.5));
      if (inputFinished) {
		if (!activeOutputTrackId || bargeInPending) return;
		const speechLike = isEchoAwareBargeSpeech(samples, playbackReferenceRms);
		bargeSpeechFrames = speechLike ? bargeSpeechFrames + 1 : 0;
		if (bargeSpeechFrames >= 3 && opened) {
			bargeInPending = true;
			void interruptCurrentOutputAndClose('barge-in').catch((error) => {
				input.callbacks.onError(error);
			});
		}
        return;
      }
	  for (const frame of primaryResampler?.push(samples) || []) {
        inputSequence += 1;
		queueAudioFrame(frame, inputTrackId, utteranceId, inputSequence);
      }
    };

    void (async () => {
      const session = opened;
      if (!session) return;
      try {
		const subscription = await client.subscribe({
          realtimeSessionId: session.realtimeSessionId,
          generation: session.generation,
          agentHandle,
		});
		const cancelSubscription = () => void subscription.cancel().catch(() => undefined);
		abortController.signal.addEventListener('abort', cancelSubscription, { once: true });
		try {
		  for await (const envelope of subscription) {
			const event = envelope.event;
          if (closed) break;
			switch (event.type) {
			case 'speech-status':
              break;
			case 'transcript':
			  input.callbacks.onTranscript(event.text, event.final);
              break;
			case 'output-track':
			  if (event.lifecycle === 'active') {
				activeOutputTrackId = event.outputTrackId;
                providerOutputActive = true;
                input.callbacks.onOutputActive(true);
			  } else if (event.outputTrackId === activeOutputTrackId) {
                providerOutputActive = false;
                if (playbackSources.size === 0) {
                  activeOutputTrackId = '';
                  input.callbacks.onOutputActive(false);
                }
                maybeCloseAfterPlayback();
              }
              break;
			case 'audio-frame':
              schedulePcm16Playback(
				event.outputTrackId,
				event.frame,
				event.format.sampleRateHz,
              );
              break;
            case 'terminal':
			  if (event.reasonCode === 'ACTION_EXECUTED') {
                turnTerminal = true;
                maybeCloseAfterPlayback();
                break;
              }
			  throw createAgentRealtimeTerminalError(event.reasonCode);
            default:
              break;
          }
		  }
		} finally {
		  abortController.signal.removeEventListener('abort', cancelSubscription);
		  await subscription.cancel().catch(() => undefined);
		}
      } catch (error) {
        if (!closed && !abortController.signal.aborted) {
          const failure = error && typeof error === 'object'
            ? error as { readonly reasonCode?: unknown; readonly message?: unknown }
            : null;
          const reasonCode = typeof failure?.reasonCode === 'string' ? failure.reasonCode : '';
          logRendererEvent({
            level: 'warn',
            area: 'agent-realtime-voice',
            message: 'event-stream:failed',
            details: {
              reasonCode,
              projectionDiagnostic: reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID' && typeof failure?.message === 'string'
                ? failure.message.slice(0, 256)
                : '',
            },
          });
          if (activeOutputTrackId) {
            try {
              await interruptCurrentOutputAndClose('event-stream-failed');
            } catch (cleanupError) {
              input.callbacks.onError(cleanupError);
              return;
            }
          } else {
            await close('event-stream-failed');
          }
          input.callbacks.onError(error);
        }
      }
    })();
  } catch (error) {
    await close('open-failed');
    throw error;
  }

  return {
    finishInput,
    close: () => close('owner-close'),
    stop: () => interruptCurrentOutputAndClose('owner-stop'),
  };

  function schedulePcm16Playback(outputTrackId: string, bytes: Uint8Array, sampleRate: number) {
    if (!audioContext || bytes.byteLength === 0 || bytes.byteLength % 2 !== 0 || sampleRate !== OUTPUT_SAMPLE_RATE) return;
    if (!activeOutputTrackId) {
      activeOutputTrackId = outputTrackId;
      input.callbacks.onOutputActive(true);
    }
    if (!outputTrackId || outputTrackId !== activeOutputTrackId) {
      throw new Error('Runtime emitted concurrent audio output tracks on one voice channel.');
    }
    const samples = new Float32Array(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true) / 32768;
	let squareSum = 0;
	for (const sample of samples) squareSum += sample * sample;
	playbackReferenceRms = Math.max(playbackReferenceRms * 0.85, Math.sqrt(squareSum / Math.max(1, samples.length)));
    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    playbackCursor = Math.max(playbackCursor, audioContext.currentTime + 0.02);
    source.start(playbackCursor);
    playbackCursor += buffer.duration;
    playbackSources.add(source);
    source.onended = () => {
      playbackSources.delete(source);
      source.disconnect();
      if (playbackSources.size === 0 && !providerOutputActive && activeOutputTrackId === outputTrackId) {
        activeOutputTrackId = '';
		playbackReferenceRms = 0;
        input.callbacks.onOutputActive(false);
      }
      maybeCloseAfterPlayback();
    };
  }
}

function resolveAgentHandle(target: AgentLocalTargetSnapshot): NimiLocalAppAgentHandle {
	if (target.agentHandle?.trim()) return target.agentHandle.trim() as NimiLocalAppAgentHandle;
  throw new Error('The selected Agent has no canonical Runtime handle.');
}

export function isEchoAwareBargeSpeech(samples: Float32Array, playbackReferenceRms: number): boolean {
  let peak = 0;
  let squareSum = 0;
  let zeroCrossings = 0;
  for (let index = 0; index < samples.length; index += 1) {
	const sample = samples[index] || 0;
	peak = Math.max(peak, Math.abs(sample));
	squareSum += sample * sample;
	if (index > 0 && ((samples[index - 1] || 0) < 0) !== (sample < 0)) zeroCrossings += 1;
  }
  const rms = Math.sqrt(squareSum / Math.max(1, samples.length));
  const zeroCrossingRate = zeroCrossings / Math.max(1, samples.length - 1);
  return peak >= 0.12
	&& rms >= Math.max(0.035, Math.max(0, playbackReferenceRms) * 0.45)
	&& zeroCrossingRate >= 0.015
	&& zeroCrossingRate <= 0.35;
}

export function createPcm16Resampler(sourceRate: number, targetRate: number) {
  const ratio = sourceRate / targetRate;
  let source: number[] = [];
  let offset = 0;
  let output: number[] = [];
  const takeFrames = (includeTail: boolean): Uint8Array[] => {
	const frames: Uint8Array[] = [];
	while (output.length >= FRAME_SAMPLES || (includeTail && output.length > 0)) {
		const sampleCount = Math.min(FRAME_SAMPLES, output.length);
		const frameSamples = output.slice(0, sampleCount);
		output = output.slice(sampleCount);
		const frame = new Uint8Array(sampleCount * 2);
		const view = new DataView(frame.buffer);
		frameSamples.forEach((sample, index) => {
			const clamped = Math.max(-1, Math.min(1, sample));
			view.setInt16(index * 2, clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767), true);
		});
		frames.push(frame);
	}
	return frames;
  };
  return {
    push(samples: Float32Array): Uint8Array[] {
      source.push(...samples);
      while (offset + 1 < source.length) {
        const floor = Math.floor(offset);
        const fraction = offset - floor;
        const first = source[floor] || 0;
        const second = source[floor + 1] || first;
        output.push(first + ((second - first) * fraction));
        offset += ratio;
      }
      const consumed = Math.floor(offset);
      if (consumed > 0) {
        source = source.slice(consumed);
        offset -= consumed;
      }
	  return takeFrames(false);
    },
	flush(): Uint8Array[] {
		let complete: Uint8Array[] = [];
		if (source.length > 0) {
			const last = source[source.length - 1] || 0;
			complete = this.push(new Float32Array([last]));
		}
		source = [];
		offset = 0;
		return [...complete, ...takeFrames(true)];
	},
  };
}
