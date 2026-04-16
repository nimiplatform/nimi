import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import {
  buildParentosRuntimeMetadata,
  resolveParentosBinding,
  resolveParentosTextSurfaceConfig,
} from './parentos-ai-runtime.js';

describe('parentos-ai-runtime access helpers', () => {
  beforeEach(() => {
    useAppStore.setState({
      aiConfig: null,
      runtimeDefaults: null,
    });
  });

  it('falls back to auto when no capability binding exists', () => {
    expect(resolveParentosBinding('text.generate')).toEqual({ model: 'auto' });
  });

  it('returns a local route for local capability bindings', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'local',
              connectorId: '',
              model: 'qwen3',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosBinding('text.generate')).toEqual({
      model: 'qwen3',
      route: 'local',
    });
  });

  it('returns a cloud route and connector id for cloud capability bindings', () => {
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
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosBinding('text.generate')).toEqual({
      model: 'gpt-5.4',
      route: 'cloud',
      connectorId: 'openai-main',
    });
  });

  it('reads dedicated vision bindings without falling back to chat bindings', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'cloud',
              connectorId: 'openai-main',
              model: 'gpt-5.4-mini',
            },
            'text.generate.vision': {
              source: 'cloud',
              connectorId: 'openai-vision',
              model: 'gpt-5.4-vision',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosBinding('text.generate.vision')).toEqual({
      model: 'gpt-5.4-vision',
      route: 'cloud',
      connectorId: 'openai-vision',
    });
  });

  it('builds stable ParentOS runtime metadata for governed surfaces', () => {
    expect(buildParentosRuntimeMetadata('parentos.advisor')).toEqual({
      callerKind: 'third-party-app',
      callerId: 'app.nimi.parentos',
      surfaceId: 'parentos.advisor',
    });
  });

  it('preserves cloud route bindings for governed ParentOS surfaces', () => {
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
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosTextSurfaceConfig('parentos.report')).toEqual({
      model: 'gpt-5.4',
      route: 'cloud',
      connectorId: 'openai-main',
      temperature: undefined,
      topP: undefined,
      maxTokens: undefined,
      timeoutMs: undefined,
    });
  });
});
