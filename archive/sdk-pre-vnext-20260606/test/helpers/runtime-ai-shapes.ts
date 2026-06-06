import type {
  ExecuteScenarioResponse,
  ScenarioOutput,
  ScenarioStreamDelta,
  StreamScenarioEvent,
} from '../../src/runtime/generated/runtime/v1/ai.js';

export function textGenerateOutput(text: string): ScenarioOutput {
  return {
    output: {
      oneofKind: 'textGenerate',
      textGenerate: {
        text,
      },
    },
  };
}

export function textEmbedOutput(vectors: number[][]): ScenarioOutput {
  return {
    output: {
      oneofKind: 'textEmbed',
      textEmbed: {
        vectors: vectors.map((values) => ({ values })),
      },
    },
  };
}

export function imageGenerateOutput(artifactId = 'img-art-1'): ScenarioOutput {
  return {
    output: {
      oneofKind: 'imageGenerate',
      imageGenerate: {
        artifacts: [{ artifactId }],
      },
    },
  };
}

export function videoGenerateOutput(artifactId = 'vid-art-1'): ScenarioOutput {
  return {
    output: {
      oneofKind: 'videoGenerate',
      videoGenerate: {
        artifacts: [{ artifactId }],
      },
    },
  };
}

export function speechTranscribeOutput(text: string, artifactId = 'stt-art-1'): ScenarioOutput {
  return {
    output: {
      oneofKind: 'speechTranscribe',
      speechTranscribe: {
        text,
        artifacts: [{ artifactId, bytes: new Uint8Array(Buffer.from(text, 'utf8')) }],
      },
    },
  };
}

export function speechSynthesizeOutput(
  artifactId = 'tts-art-1',
  mimeType = 'audio/wav',
  bytes = new Uint8Array(Buffer.from('tts-audio', 'utf8')),
): ScenarioOutput {
  return {
    output: {
      oneofKind: 'speechSynthesize',
      speechSynthesize: {
        artifacts: [{ artifactId, mimeType, bytes }],
      },
    },
  };
}

export function musicGenerateOutput(artifactId = 'music-art-1'): ScenarioOutput {
  return {
    output: {
      oneofKind: 'musicGenerate',
      musicGenerate: {
        artifacts: [{ artifactId }],
      },
    },
  };
}

export function executeTextGenerateResponse(text: string): Pick<ExecuteScenarioResponse, 'output'> {
  return {
    output: textGenerateOutput(text),
  };
}

export function executeTextEmbedResponse(vectors: number[][]): Pick<ExecuteScenarioResponse, 'output'> {
  return {
    output: textEmbedOutput(vectors),
  };
}

export function textDelta(text: string): ScenarioStreamDelta {
  return {
    delta: {
      oneofKind: 'text',
      text: {
        text,
      },
    },
  };
}

export function artifactDelta(chunk: Uint8Array, mimeType: string): ScenarioStreamDelta {
  return {
    delta: {
      oneofKind: 'artifact',
      artifact: {
        chunk,
        mimeType,
      },
    },
  };
}

export function textDeltaEvent(text: string): Pick<StreamScenarioEvent, 'payload'> {
  return {
    payload: {
      oneofKind: 'delta',
      delta: textDelta(text),
    },
  };
}

export function artifactDeltaEvent(chunk: Uint8Array, mimeType: string): Pick<StreamScenarioEvent, 'payload'> {
  return {
    payload: {
      oneofKind: 'delta',
      delta: artifactDelta(chunk, mimeType),
    },
  };
}
