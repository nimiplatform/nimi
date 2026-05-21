import { describe, expect, it } from 'vitest';
import type { OwnerPortfolioAgentDetail, SettingField } from './portfolio-data.js';
import {
  VOICE_DEMO_BLOCKED_REASON,
  VISUAL_MEDIA_BLOCKED_REASON,
  assertNoForbiddenMediaCandidateFields,
  buildBlockedVisualAssetCandidatePayload,
  buildBlockedVoiceDemoRequestPayload,
  isAllowedMediaCandidateBindingPoint,
  isAllowedMediaCandidateResourceType,
  normalizeVisualMediaCandidateInput,
  normalizeVoiceDemoCandidateInput,
  type BlockedVisualAssetCandidatePayload,
  type BlockedVoiceDemoRequestPayload,
} from './media-voice-candidate.js';

function settingField(key: SettingField['key'], label: string, value: string): SettingField {
  return {
    key,
    label,
    value,
    status: value ? 'available' : 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    unavailableLabel: value ? undefined : 'setting read unavailable',
  };
}

const agent: OwnerPortfolioAgentDetail = {
  id: 'agent-1',
  displayName: settingField('displayName', 'Display name', 'Mira'),
  handle: settingField('handle', 'Handle', 'mira'),
  bio: settingField('bio', 'Bio', 'Public strategist bio'),
  greeting: settingField('greeting', 'Greeting', 'Welcome in.'),
  profileCoverUrl: settingField('profileCoverUrl', 'Profile cover URL', 'https://cdn.example.test/cover.png'),
  ownership: settingField('ownership', 'Ownership evidence', 'MASTER_OWNED'),
  world: settingField('world', 'World evidence', 'OASIS'),
  state: settingField('state', 'State evidence', 'ACTIVE'),
  avatarUrl: 'https://cdn.example.test/avatar.png',
  friendCount: { status: 'available', value: 7 },
  source: 'Realm MeService.getMyRealmAgent',
};

function collectKeys(value: unknown, keys = new Set<string>()) {
  if (!value || typeof value !== 'object') {
    return keys;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }
  return keys;
}

describe('media and voice candidate normalization', () => {
  it('validates admitted resource types and binding points', () => {
    expect(isAllowedMediaCandidateResourceType('IMAGE')).toBe(true);
    expect(isAllowedMediaCandidateResourceType('VIDEO')).toBe(true);
    expect(isAllowedMediaCandidateResourceType('AUDIO')).toBe(true);
    expect(isAllowedMediaCandidateResourceType('VOICE')).toBe(false);
    expect(isAllowedMediaCandidateBindingPoint('AGENT_AVATAR')).toBe(true);
    expect(isAllowedMediaCandidateBindingPoint('AGENT_VOICE_SAMPLE')).toBe(true);
    expect(isAllowedMediaCandidateBindingPoint('WORLD_SCENE')).toBe(false);
  });

  it('normalizes visual input and falls back to local candidate defaults', () => {
    expect(normalizeVisualMediaCandidateInput({
      resourceType: 'VIDEO',
      bindingPoint: 'WORLD_SCENE',
      prompt: '  cinematic portrait\r\nsoft light  ',
      notes: '  owner reviewed only  ',
    })).toEqual({
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_CANDIDATE',
      prompt: 'cinematic portrait\nsoft light',
      notes: 'owner reviewed only',
    });
  });

  it('normalizes voice input to Resource(AUDIO) and AGENT_VOICE_SAMPLE', () => {
    expect(normalizeVoiceDemoCandidateInput({
      scriptText: '  Hello\r\nfrom the public demo.  ',
    })).toEqual({
      resourceType: 'AUDIO',
      bindingPoint: 'AGENT_VOICE_SAMPLE',
      scriptText: 'Hello\nfrom the public demo.',
    });
  });
});

describe('blocked visual asset candidate payload', () => {
  it('builds a blocked Resource and Binding evidence preview without success fields', () => {
    const result = buildBlockedVisualAssetCandidatePayload({
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      prompt: 'Reference turntable with calm expression.',
      notes: 'Use only public profile context.',
    }, agent);

    expect(result.changed).toBe(true);
    expect(result.payload).toEqual({
      candidate: true,
      blocked: true,
      publicTruth: false,
      blockedReason: VISUAL_MEDIA_BLOCKED_REASON,
      source: 'realm-agent-studio.local-visual-media-candidate',
      agentContext: {
        source: 'Realm MeService.getMyRealmAgent',
        agentKey: 'agent-1',
        handle: 'mira',
        displayName: 'Mira',
        bio: 'Public strategist bio',
        greeting: 'Welcome in.',
        profileCoverUrl: 'https://cdn.example.test/cover.png',
      },
      localDraft: {
        prompt: 'Reference turntable with calm expression.',
        notes: 'Use only public profile context.',
      },
      futureEvidencePath: {
        resource: {
          carrier: 'Resource',
          type: 'IMAGE',
          status: 'candidate-only',
        },
        binding: {
          family: 'Binding',
          hostType: 'AGENT',
          objectType: 'RESOURCE',
          bindingPoint: 'AGENT_PORTRAIT',
          status: 'candidate-blocked',
        },
      },
    } satisfies BlockedVisualAssetCandidatePayload);

    const keys = collectKeys(result.payload);
    expect(keys.has('provider')).toBe(false);
    expect(keys.has('model')).toBe(false);
    expect(keys.has('localAgent')).toBe(false);
    expect(keys.has('worldId')).toBe(false);
    expect(keys.has('publicSuccess')).toBe(false);
    expect(keys.has('bindingSuccess')).toBe(false);
    expect(keys.has('resourceReady')).toBe(false);
  });

  it('fails closed when visual prompt is empty', () => {
    const result = buildBlockedVisualAssetCandidatePayload({
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_AVATAR',
      prompt: ' ',
      notes: '',
    }, agent);

    expect(result).toEqual({
      blocked: true,
      changed: false,
      errors: ['visual prompt missing'],
      payload: null,
    });
  });
});

describe('blocked voice demo request payload', () => {
  it('builds a blocked Runtime audio.synthesize preview and Resource(AUDIO) path', () => {
    const result = buildBlockedVoiceDemoRequestPayload({
      scriptText: '  Welcome in.\nThis is a local sample candidate.  ',
    }, agent);

    expect(result.changed).toBe(true);
    expect(result.payload).toEqual({
      candidate: true,
      blocked: true,
      publicTruth: false,
      blockedReason: VOICE_DEMO_BLOCKED_REASON,
      source: 'realm-agent-studio.local-voice-demo-candidate',
      agentContext: {
        source: 'Realm MeService.getMyRealmAgent',
        agentKey: 'agent-1',
        handle: 'mira',
        displayName: 'Mira',
        bio: 'Public strategist bio',
        greeting: 'Welcome in.',
        profileCoverUrl: 'https://cdn.example.test/cover.png',
      },
      runtimePreview: {
        capabilityToken: 'audio.synthesize',
        currentSdkPath: 'media.tts.synthesize',
        requestCandidate: {
          text: 'Welcome in.\nThis is a local sample candidate.',
          metadata: {
            source: 'realm-agent-studio.local-voice-demo-candidate',
            agentKey: 'agent-1',
          },
        },
        status: 'candidate-blocked',
      },
      futureEvidencePath: {
        resource: {
          carrier: 'Resource',
          type: 'AUDIO',
          status: 'candidate-only',
        },
        binding: {
          family: 'Binding',
          hostType: 'AGENT',
          objectType: 'RESOURCE',
          bindingPoint: 'AGENT_VOICE_SAMPLE',
          status: 'candidate-blocked',
        },
      },
    } satisfies BlockedVoiceDemoRequestPayload);
  });

  it('fails closed when voice script is empty', () => {
    const result = buildBlockedVoiceDemoRequestPayload({ scriptText: ' ' }, agent);

    expect(result).toEqual({
      blocked: true,
      changed: false,
      errors: ['voice demo script missing'],
      payload: null,
    });
  });

  it('detects forbidden media candidate fields recursively', () => {
    expect(assertNoForbiddenMediaCandidateFields({
      runtimePreview: {
        provider: 'forbidden',
      },
    })).toBe('provider');
    expect(assertNoForbiddenMediaCandidateFields({
      localAgent: { model: 'forbidden' },
    })).toBe('localAgent');
    expect(assertNoForbiddenMediaCandidateFields({
      futureEvidencePath: {
        resource: {
          carrier: 'Resource',
          type: 'AUDIO',
        },
      },
    })).toBeNull();
  });
});
