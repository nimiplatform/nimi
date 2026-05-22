import type { Realm } from '@nimiplatform/sdk/realm';
import { describe, expect, it, vi } from 'vitest';
import {
  buildFinalizeDirectMediaResourceInput,
  buildRealmCreateAgentInput,
  buildRealmCreatePostInput,
  buildRealmPostTextResourceInput,
  buildRealmSelectAvatarInput,
  buildRealmUpdateVisibilityInput,
  buildRuntimeProjectionInput,
  checkCreateRealmAgentHandleAvailability,
  createAgentVisibilityDraft,
  createReviewedPostTextResource,
  createReviewedRealmAgent,
  generateReviewedVisualImageCandidate,
  getAgentVisibilitySettings,
  getCreateRealmAgentWorldPreview,
  getOwnerAgentSettings,
  getOwnerPortfolioAgentDetail,
  listCreateRealmAgentSelectableWorlds,
  listOwnerPortfolioAgents,
  listReadyPostAttachmentResources,
  normalizeFinalizedDirectMediaResource,
  normalizePostAttachmentResourceOptions,
  normalizeRealmAgentAvatarSelectResult,
  normalizeRealmAgentCreateResult,
  normalizeRealmPostPublishResult,
  normalizeRealmTextResourceCreateResult,
  normalizeRuntimeProjectionSummary,
  projectAgentRuntimeContextSummary,
  proposeReviewedOwnerAgentSettings,
  proposeReviewedPostCopy,
  publishReviewedPostDraft,
  selectReviewedAgentAvatarUrl,
  synthesizeReviewedVoiceDemo,
  updateReviewedAgentVisibility,
  updateReviewedOwnerAgentSettings,
  uploadReviewedIdentityMediaResource,
  uploadReviewedPostMediaResource,
  type AgentVisibilityDraft,
  type RealmAgentVisibilitySettings,
} from './portfolio-client.js';
import { REALM_AGENT_CREATE_SOURCE, type ReviewedCreateRealmAgentPayload } from './create-agent-draft.js';
import { createOwnerAgentSettingsDraft } from './setting-proposal.js';
import {
  candidatePayload,
  collectKeys,
  createPayload,
  detailField,
  mockRealm,
  ownerAgentDetail,
  ownerAgentDetailWithWorldId,
} from './portfolio-client.test-helpers.js';

describe('owner portfolio media client', () => {
     it('selects a reviewed avatar URL through AgentsService.agentControllerSelectAvatar only', async () => {
      const realm = mockRealm();
      const result = await selectReviewedAgentAvatarUrl('agent-1', ' https://cdn.example.test/avatar.png ', realm);
      const selectAvatar = realm.services.AgentsService.agentControllerSelectAvatar;
      const submittedPayload = vi.mocked(selectAvatar).mock.calls[0]?.[1];

      expect(selectAvatar).toHaveBeenCalledWith('agent-1', {
        avatarUrl: 'https://cdn.example.test/avatar.png',
      });
      expect(submittedPayload).toEqual({
        avatarUrl: 'https://cdn.example.test/avatar.png',
      });
      expect(Object.keys(submittedPayload || {})).toEqual(['avatarUrl']);
      expect(collectKeys(submittedPayload).has('profileCoverUrl')).toBe(false);
      expect(collectKeys(submittedPayload).has('resourceId')).toBe(false);
      expect(collectKeys(submittedPayload).has('bindingId')).toBe(false);
      expect(collectKeys(submittedPayload).has('provider')).toBe(false);
      expect(collectKeys(submittedPayload).has('model')).toBe(false);
      expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: 'Realm AgentsService.agentControllerSelectAvatar',
        publicTruth: true,
        realm: {
          success: true,
        },
      });
    });

     it('rejects invalid avatar URLs before calling Realm', async () => {
      const realm = mockRealm();
      const result = await selectReviewedAgentAvatarUrl('agent-1', 'data:text/plain,avatar', realm);

      expect(realm.services.AgentsService.agentControllerSelectAvatar).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        source: 'Realm AgentsService.agentControllerSelectAvatar',
        publicTruth: false,
        failure: 'avatar-url-invalid',
        submitted: null,
      });
    });

     it('fails closed when Realm rejects avatar selection success confirmation', () => {
      const submitted = {
        avatarUrl: 'https://cdn.example.test/avatar.png',
      };
      const result = normalizeRealmAgentAvatarSelectResult({ success: false }, submitted);

      expect(result).toMatchObject({
        ok: false,
        source: 'Realm AgentsService.agentControllerSelectAvatar',
        publicTruth: false,
        failure: 'realm-select-avatar-rejected',
        submitted,
      });
    });

     it('builds SelectAvatarDto from a narrow URL allowlist', () => {
      expect(buildRealmSelectAvatarInput(' https://cdn.example.test/avatar.png ')).toEqual({
        avatarUrl: 'https://cdn.example.test/avatar.png',
      });
      expect(buildRealmSelectAvatarInput('ftp://cdn.example.test/avatar.png')).toBeNull();
      expect(buildRealmSelectAvatarInput('')).toBeNull();
    });

     it('calls Runtime media.image.generate for visual candidates only', async () => {
      const runtime = {
        media: {
          image: {
            generate: vi.fn(async (_input: unknown) => ({
              job: {
                jobId: 'job-image-1',
                modelResolved: 'runtime-image-model',
                traceId: 'trace-image-job',
              },
              artifacts: [{
                artifactId: 'artifact-image-1',
                mimeType: 'image/png',
                uri: 'runtime://artifact-image-1',
              }],
              trace: {
                traceId: 'trace-image-output',
              },
            })),
          },
        },
      };

      const result = await generateReviewedVisualImageCandidate({
        resourceType: 'IMAGE',
        bindingPoint: 'AGENT_CANDIDATE',
        prompt: 'Warm profile portrait.',
        notes: 'Use public bio only.',
        model: 'runtime-image-model',
        aspectRatio: '1:1',
      }, ownerAgentDetail(), runtime as unknown as Parameters<typeof generateReviewedVisualImageCandidate>[2]);

      const submittedPayload = vi.mocked(runtime.media.image.generate).mock.calls[0]?.[0];
      expect(runtime.media.image.generate).toHaveBeenCalledTimes(1);
      expect(submittedPayload).toMatchObject({
        model: 'runtime-image-model',
        n: 1,
        aspectRatio: '1:1',
        responseFormat: 'url',
        metadata: {
          source: 'realm-agent-studio.reviewed-visual-image-candidate',
          agentKey: 'agent-1',
          bindingPoint: 'AGENT_CANDIDATE',
        },
      });
      expect(collectKeys(submittedPayload).has('provider')).toBe(false);
      expect(collectKeys(submittedPayload).has('localAgent')).toBe(false);
      expect(collectKeys(submittedPayload).has('worldId')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: 'Runtime media.image.generate',
        candidate: true,
        publicTruth: false,
        runtime: {
          jobId: 'job-image-1',
          artifactIds: ['artifact-image-1'],
          artifactUris: ['runtime://artifact-image-1'],
          traceId: 'trace-image-output',
          modelResolved: 'runtime-image-model',
        },
      });
    });

     it('fails closed when Runtime media.image.generate output has no real job or artifact', async () => {
      const runtime = {
        media: {
          image: {
            generate: vi.fn(async () => ({
              job: {},
              artifacts: [],
              trace: {},
            })),
          },
        },
      };

      const result = await generateReviewedVisualImageCandidate({
        resourceType: 'IMAGE',
        bindingPoint: 'AGENT_CANDIDATE',
        prompt: 'Warm profile portrait.',
        notes: '',
        model: 'runtime-image-model',
        aspectRatio: '1:1',
      }, ownerAgentDetail(), runtime as unknown as Parameters<typeof generateReviewedVisualImageCandidate>[2]);

      expect(result).toMatchObject({
        ok: false,
        source: 'Runtime media.image.generate',
        failure: 'runtime-output-missing',
        message: 'Runtime media.image.generate output missing real job id, artifact id, or artifact URI.',
      });
    });

     it('calls Runtime media.tts.synthesize with the allowlisted reviewed voice body', async () => {
      const runtime = {
        media: {
          tts: {
            synthesize: vi.fn(async (_input: unknown) => ({
              job: {
                jobId: 'job-voice-1',
                modelResolved: 'runtime-tts-model',
                traceId: 'trace-job-1',
              },
              artifacts: [{
                artifactId: 'artifact-audio-1',
                mimeType: 'audio/wav',
              }],
              trace: {
                traceId: 'trace-output-1',
              },
            })),
          },
        },
      };

      const result = await synthesizeReviewedVoiceDemo({
        scriptText: '  Welcome in.  ',
        model: 'runtime-tts-model',
      }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

      expect(runtime.media.tts.synthesize).toHaveBeenCalledWith({
        model: 'runtime-tts-model',
        text: 'Welcome in.',
        metadata: {
          source: 'realm-agent-studio.reviewed-voice-demo-candidate',
          agentKey: 'agent-1',
        },
      });
      const submittedPayload = vi.mocked(runtime.media.tts.synthesize).mock.calls[0]?.[0];
      expect(Object.keys(submittedPayload || {}).sort()).toEqual(['metadata', 'model', 'text']);
      expect(collectKeys(submittedPayload).has('provider')).toBe(false);
      expect(collectKeys(submittedPayload).has('localAgent')).toBe(false);
      expect(collectKeys(submittedPayload).has('emotion')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: 'Runtime media.tts.synthesize',
        candidate: true,
        publicTruth: false,
        runtime: {
          jobId: 'job-voice-1',
          artifactIds: ['artifact-audio-1'],
          traceId: 'trace-output-1',
          modelResolved: 'runtime-tts-model',
        },
      });
    });

     it('fails closed when Runtime media.tts.synthesize model config is missing', async () => {
      const runtime = {
        media: {
          tts: {
            synthesize: vi.fn(),
          },
        },
      };
      const result = await synthesizeReviewedVoiceDemo({
        scriptText: 'Welcome in.',
        model: '',
      }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

      expect(runtime.media.tts.synthesize).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        source: 'Runtime media.tts.synthesize',
        failure: 'runtime-payload-invalid',
        message: 'Runtime media.tts.synthesize model config missing',
      });
    });

     it('fails closed when Runtime media.tts.synthesize output has no real job or artifact id', async () => {
      const runtime = {
        media: {
          tts: {
            synthesize: vi.fn(async (_input: unknown) => ({
              job: {},
              artifacts: [],
              trace: {},
            })),
          },
        },
      };
      const result = await synthesizeReviewedVoiceDemo({
        scriptText: 'Welcome in.',
        model: 'runtime-tts-model',
      }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

      expect(result).toMatchObject({
        ok: false,
        source: 'Runtime media.tts.synthesize',
        failure: 'runtime-output-missing',
        message: 'Runtime media.tts.synthesize output missing real job id or artifact id.',
      });
    });

     it('fails closed and preserves draft when Runtime media.tts.synthesize throws', async () => {
      const runtime = {
        media: {
          tts: {
            synthesize: vi.fn(async () => {
              throw new Error('runtime unavailable');
            }),
          },
        },
      };
      const result = await synthesizeReviewedVoiceDemo({
        scriptText: 'Welcome in.',
        model: 'runtime-tts-model',
      }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

      expect(runtime.media.tts.synthesize).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: false,
        source: 'Runtime media.tts.synthesize',
        failure: 'runtime-synthesize-failed',
        message: 'Runtime media.tts.synthesize failed: runtime unavailable',
        draft: {
          candidate: true,
          publicTruth: false,
        },
      });
    });
});
