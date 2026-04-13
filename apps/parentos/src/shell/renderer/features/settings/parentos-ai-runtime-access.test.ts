import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import { resolveParentosBinding } from './parentos-ai-runtime.js';

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
});
