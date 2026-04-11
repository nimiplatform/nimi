import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import {
  resolveParentosSpeechTranscribeConfig,
  resolveParentosTextGenerateConfig,
} from './parentos-ai-runtime.js';

describe('parentos-ai-runtime', () => {
  beforeEach(() => {
    useAppStore.setState({ aiConfig: null });
  });

  it('merges text capability defaults with stored runtime config', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'cloud',
              connectorId: 'openai-main',
              model: 'gpt-5.4',
            },
          },
          localProfileRefs: {},
          selectedParams: {
            'text.generate': {
              temperature: 0.2,
              maxTokens: 900,
            },
          },
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosTextGenerateConfig({ temperature: 0.7, topP: 0.9, maxTokens: 1024 })).toEqual({
      model: 'gpt-5.4',
      route: 'cloud',
      connectorId: 'openai-main',
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 900,
      timeoutMs: undefined,
    });
  });

  it('merges speech transcribe defaults with stored runtime config', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'audio.transcribe': {
              source: 'local',
              connectorId: '',
              model: 'whisper-large-v3',
            },
          },
          localProfileRefs: {},
          selectedParams: {
            'audio.transcribe': {
              prompt: '儿童成长记录',
              diarization: true,
              speakerCount: 2,
            },
          },
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosSpeechTranscribeConfig({ language: 'zh-CN', responseFormat: 'text', timestamps: false })).toEqual({
      model: 'whisper-large-v3',
      route: 'local',
      language: 'zh-CN',
      responseFormat: 'text',
      timestamps: false,
      diarization: true,
      speakerCount: 2,
      prompt: '儿童成长记录',
      timeoutMs: undefined,
    });
  });
});
