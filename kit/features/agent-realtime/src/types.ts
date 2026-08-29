import type {
  NimiAgentRealtimeEvent,
  NimiError,
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
  NimiRealtimeAudioFormat,
  NimiRealtimeControlStatus,
  NimiRealtimeEventEnvelope,
  NimiRealtimeOperationResult,
  NimiRealtimeSubscription,
} from '@nimiplatform/kit/core/sdk-contract';

export type NimiAgentRealtimeClient = NimiLocalAppClient['agentRealtime'];

export type NimiAgentRealtimeOpenResult = Awaited<
  ReturnType<NimiAgentRealtimeClient['open']>
>;

export type NimiAgentRealtimeLifecycle =
  | 'idle'
  | 'opening'
  | 'ready'
  | 'degraded'
  | 'reconnecting'
  | 'closing'
  | 'closed'
  | 'failed';

export type NimiAgentRealtimeCaptureState =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'stopped'
  | 'permission-denied'
  | 'device-unavailable'
  | 'device-lost';

export type NimiAgentRealtimePlaybackState =
  | 'idle'
  | 'playing'
  | 'unavailable';

export type NimiAgentRealtimeSessionState = {
  readonly sessionEpoch: number;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string | null;
  readonly lifecycle: NimiAgentRealtimeLifecycle;
  readonly capture: NimiAgentRealtimeCaptureState;
  readonly playback: NimiAgentRealtimePlaybackState;
  readonly pressure: NimiRealtimeControlStatus['backpressure'];
  readonly control: NimiRealtimeControlStatus | null;
  readonly negotiatedInputAudio: NimiRealtimeAudioFormat | null;
  readonly negotiatedOutputAudio: NimiRealtimeAudioFormat | null;
  readonly activeOutputTrackIds: readonly string[];
  readonly error: NimiError | null;
};

export type NimiAgentRealtimeSessionAction =
  | {
    readonly type: 'open-requested';
    readonly epoch: number;
  }
  | {
    readonly type: 'open-succeeded';
    readonly epoch: number;
    readonly result: NimiAgentRealtimeOpenResult;
  }
  | {
    readonly type: 'control-observed';
    readonly epoch: number;
    readonly control: NimiRealtimeControlStatus;
  }
  | {
    readonly type: 'event-observed';
    readonly epoch: number;
    readonly event: NimiAgentRealtimeEvent;
  }
  | {
    readonly type: 'capture-requested';
    readonly epoch: number;
  }
  | {
    readonly type: 'capture-started';
    readonly epoch: number;
  }
  | {
    readonly type: 'capture-stopped';
    readonly epoch: number;
    readonly state: Extract<
      NimiAgentRealtimeCaptureState,
      'stopped' | 'device-lost'
    >;
  }
  | {
    readonly type: 'capture-unavailable';
    readonly epoch: number;
    readonly state: Extract<
      NimiAgentRealtimeCaptureState,
      'permission-denied' | 'device-unavailable'
    >;
    readonly error: NimiError;
  }
  | {
    readonly type: 'playback-failed';
    readonly epoch: number;
    readonly error: NimiError;
  }
  | {
    readonly type: 'operation-failed';
    readonly epoch: number;
    readonly error: NimiError;
    readonly terminal: boolean;
  }
  | {
    readonly type: 'issue-cleared';
    readonly epoch: number;
  }
  | {
    readonly type: 'close-requested';
    readonly epoch: number;
  }
  | {
    readonly type: 'closed';
    readonly epoch: number;
  };

export type NimiAgentRealtimeCapturedFrame = {
  readonly frameSequence: string;
  readonly frame: Uint8Array;
};

export type NimiAgentRealtimeCaptureHandle = {
  readonly inputTrackId: string;
  readonly utteranceId: string;
  /** Releases the exact native device. It must be idempotent. */
  readonly stop: () => Promise<void>;
};

export type NimiAgentRealtimeCaptureStartResult =
  | {
    readonly status: 'ready';
    readonly capture: NimiAgentRealtimeCaptureHandle;
  }
  | { readonly status: 'permission-denied' }
  | { readonly status: 'device-unavailable' };

export type NimiAgentRealtimeMicrophonePort = {
  /**
   * Starts only from the session's explicit `requestCapture` action. The Host
   * owns OS permission, device choice, framing, and device-loss observation.
   * It must await each `onFrame` result before delivering another frame.
   */
  readonly beginCapture: (input: {
    readonly format: NimiRealtimeAudioFormat;
    readonly onFrame: (frame: NimiAgentRealtimeCapturedFrame) => Promise<void>;
    readonly onCaptureEnded: (
      reason: 'device-lost' | 'capture-overrun',
    ) => Promise<void>;
  }) => Promise<NimiAgentRealtimeCaptureStartResult>;
};

export type NimiAgentRealtimePlaybackPort = {
  /** Receives negotiated PCM frames; decoding and the audio clock stay Host-owned. */
  readonly writeAudioFrame: (input: {
    readonly outputTrackId: string;
    readonly frameSequence: string;
    readonly frame: Uint8Array;
    readonly format: NimiRealtimeAudioFormat;
  }) => Promise<void>;
  readonly finishOutputTrack: (input: {
    readonly outputTrackId: string;
    readonly lifecycle: 'interrupted' | 'completed' | 'failed';
  }) => Promise<void>;
  readonly interruptOutputTrack: (input: {
    readonly outputTrackId: string;
  }) => Promise<void>;
  readonly close: () => Promise<void>;
};

export type NimiAgentRealtimeHostMediaPort = {
  readonly microphone: NimiAgentRealtimeMicrophonePort;
  readonly playback: NimiAgentRealtimePlaybackPort;
};

export type CreateNimiAgentRealtimeSessionInput = {
  readonly agentRealtime: NimiAgentRealtimeClient;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId?: string;
  readonly inputAudio: NimiRealtimeAudioFormat;
  readonly turnDetection: 'server-vad' | 'manual';
  readonly host: NimiAgentRealtimeHostMediaPort;
};

export type NimiAgentRealtimeCaptureRequestResult =
  | { readonly status: 'started' }
  | {
    readonly status: 'permission-denied' | 'device-unavailable';
    readonly error: NimiError;
  };

export type NimiAgentRealtimeSession = {
  readonly getState: () => NimiAgentRealtimeSessionState;
  readonly subscribeState: (
    listener: (state: NimiAgentRealtimeSessionState) => void,
  ) => () => void;
  readonly subscribeEvents: (
    listener: (event: NimiAgentRealtimeEvent) => void,
  ) => () => void;
  readonly open: () => Promise<NimiAgentRealtimeOpenResult>;
  readonly sendText: (input: {
    readonly requestId: string;
    readonly text: string;
  }) => Promise<NimiRealtimeOperationResult>;
  readonly requestCapture: () => Promise<NimiAgentRealtimeCaptureRequestResult>;
  readonly stopCapture: () => Promise<NimiRealtimeOperationResult>;
  readonly interruptOutput: (input: {
    readonly outputTrackId: string;
    readonly interruptAgentTurn: boolean;
  }) => Promise<NimiRealtimeOperationResult>;
  readonly close: () => Promise<NimiRealtimeOperationResult | null>;
};

export type {
  NimiAgentRealtimeEvent,
  NimiError,
  NimiLocalAppAgentHandle,
  NimiRealtimeAudioFormat,
  NimiRealtimeControlStatus,
  NimiRealtimeEventEnvelope,
  NimiRealtimeOperationResult,
  NimiRealtimeSubscription,
};
