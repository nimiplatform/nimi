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

describe('owner portfolio posts client', () => {
     it('publishes a reviewed post draft through PostsService.createPost without forbidden caller-owned keys', async () => {
      const realm = mockRealm();
      const result = await publishReviewedPostDraft(candidatePayload, realm);
      const createPost = realm.services.PostsService.createPost;
      const submittedPayload = vi.mocked(createPost).mock.calls[0]?.[0];

      expect(createPost).toHaveBeenCalledTimes(1);
      expect(submittedPayload).toEqual({
        attachments: [{
          targetType: 'RESOURCE',
          targetId: 'resource-1',
        }],
        caption: 'Published caption',
        tags: ['studio'],
      });
      expect(collectKeys(submittedPayload).has('id')).toBe(false);
      expect(collectKeys(submittedPayload).has('authorId')).toBe(false);
      expect(collectKeys(submittedPayload).has('worldId')).toBe(false);
      expect(collectKeys(submittedPayload).has('scheduledAt')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        canonical: {
          id: 'post-1',
          worldId: 'world-from-realm',
          moderationStatus: 'PENDING',
          visibility: 'PUBLIC',
        },
      });
    });

     it('creates a reviewed post text Resource through ResourcesService.createTextResource only', async () => {
      const realm = mockRealm();
      const result = await createReviewedPostTextResource(candidatePayload, realm);
      const createTextResource = realm.services.ResourcesService.createTextResource;
      const submittedPayload = vi.mocked(createTextResource).mock.calls[0]?.[0];

      expect(createTextResource).toHaveBeenCalledTimes(1);
      expect(submittedPayload).toEqual({
        content: 'Published caption',
        agentId: 'agent-1',
        deliveryAccess: 'SIGNED',
        label: 'Reviewed post text for @mira',
        mimeType: 'text/plain; charset=utf-8',
        sourceRef: 'realm-agent-studio.reviewed-post-text-resource',
        title: 'Published caption',
        tags: ['studio'],
        metadata: {
          source: 'realm-agent-studio.reviewed-post-text-resource',
          agentKey: 'agent-1',
          attachmentPurpose: 'post',
          humanReviewed: true,
        },
      });
      expect(Object.keys(submittedPayload || {}).sort()).toEqual([
        'agentId',
        'content',
        'deliveryAccess',
        'label',
        'metadata',
        'mimeType',
        'sourceRef',
        'tags',
        'title',
      ]);
      expect(collectKeys(submittedPayload).has('worldId')).toBe(false);
      expect(collectKeys(submittedPayload).has('authorId')).toBe(false);
      expect(collectKeys(submittedPayload).has('postId')).toBe(false);
      expect(collectKeys(submittedPayload).has('id')).toBe(false);
      expect(collectKeys(submittedPayload).has('provider')).toBe(false);
      expect(collectKeys(submittedPayload).has('model')).toBe(false);
      expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: 'Realm ResourcesService.createTextResource',
        attachmentTruth: true,
        canonical: {
          id: 'resource-text-1',
          resourceType: 'TEXT',
          status: 'READY',
          deliveryAccess: 'SIGNED',
        },
      });
    });

     it('lists READY Resource attachment options without treating non-ready resources as publishable', async () => {
      const realm = mockRealm();
      const resources = await listReadyPostAttachmentResources(realm);

      expect(realm.services.ResourcesService.listResources).toHaveBeenCalledTimes(1);
      expect(resources).toEqual([{
        id: 'resource-text-1',
        resourceType: 'TEXT',
        status: 'READY',
        label: 'Published caption',
        deliveryAccess: 'SIGNED',
        source: 'Realm ResourcesService.listResources',
      }]);
      expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
    });

     it('normalizes Resource attachment options from READY resources only', () => {
      expect(normalizePostAttachmentResourceOptions({
        items: [
          { id: 'resource-ready-image', resourceType: 'IMAGE', status: 'READY', title: 'Ready portrait' },
          { id: 'resource-ready-video', resourceType: 'VIDEO', status: 'READY', label: 'Ready trailer' },
          { id: 'resource-ready-audio', resourceType: 'AUDIO', status: 'READY', storageRef: 'audio/user-1/ready.mp3' },
          { id: 'resource-pending-video', resourceType: 'VIDEO', status: 'PENDING', title: 'Pending video' },
          { id: 'resource-deleted-audio', resourceType: 'AUDIO', status: 'DELETED', title: 'Deleted audio' },
          { id: 'resource-unknown', resourceType: 'VOICE', status: 'READY', title: 'Unknown type' },
        ],
      } as Awaited<ReturnType<Realm['services']['ResourcesService']['listResources']>>)).toEqual([{
        id: 'resource-ready-image',
        resourceType: 'IMAGE',
        status: 'READY',
        label: 'Ready portrait',
        source: 'Realm ResourcesService.listResources',
      }, {
        id: 'resource-ready-video',
        resourceType: 'VIDEO',
        status: 'READY',
        label: 'Ready trailer',
        source: 'Realm ResourcesService.listResources',
      }, {
        id: 'resource-ready-audio',
        resourceType: 'AUDIO',
        status: 'READY',
        label: 'audio/user-1/ready.mp3',
        source: 'Realm ResourcesService.listResources',
      }]);
    });

     it('uploads reviewed image Resource through direct upload and finalize only', async () => {
      const realm = mockRealm();
      const storageUpload = vi.fn(async () => undefined);
      const result = await uploadReviewedPostMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
        agent: ownerAgentDetailWithWorldId(),
      }, realm, storageUpload);
      const finalizeResource = realm.services.ResourcesService.finalizeResource;
      const finalizePayload = vi.mocked(finalizeResource).mock.calls[0]?.[1];

      expect(realm.services.ResourcesService.createImageDirectUpload).toHaveBeenCalledWith('true');
      expect(storageUpload).toHaveBeenCalledWith({
        uploadUrl: 'https://upload.example.test/image',
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      });
      expect(finalizeResource).toHaveBeenCalledWith('resource-image-upload', {
        agentId: 'agent-1',
        deliveryAccess: 'SIGNED',
        label: 'Reviewed post image upload for @mira',
        mimeType: 'image/png',
        sizeBytes: 2048,
        sourceRef: 'realm-agent-studio.reviewed-post-media-resource',
        title: 'portrait.png',
        metadata: {
          source: 'realm-agent-studio.reviewed-post-media-resource',
          agentKey: 'agent-1',
          attachmentPurpose: 'post',
          resourceType: 'IMAGE',
          humanReviewed: true,
        },
      });
      expect(collectKeys(finalizePayload).has('worldId')).toBe(false);
      expect(collectKeys(finalizePayload).has('authorId')).toBe(false);
      expect(collectKeys(finalizePayload).has('id')).toBe(false);
      expect(collectKeys(finalizePayload).has('provider')).toBe(false);
      expect(collectKeys(finalizePayload).has('model')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: 'Realm ResourcesService direct upload + finalizeResource',
        attachmentTruth: true,
        publicTruth: false,
        canonical: {
          id: 'resource-image-upload',
          resourceType: 'IMAGE',
          status: 'READY',
        },
      });
    });

     it('uploads reviewed identity image Resource without claiming profile binding truth', async () => {
      const realm = mockRealm();
      const storageUpload = vi.fn(async () => undefined);
      const result = await uploadReviewedIdentityMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'identity.png', type: 'image/png', size: 3072 },
        agent: ownerAgentDetailWithWorldId(),
        tags: ['realm-agent-studio', 'identity-candidate'],
      }, realm, storageUpload);
      const finalizeResource = realm.services.ResourcesService.finalizeResource;
      const finalizePayload = vi.mocked(finalizeResource).mock.calls[0]?.[1];

      expect(finalizeResource).toHaveBeenCalledWith('resource-image-upload', expect.objectContaining({
        agentId: 'agent-1',
        label: 'Reviewed identity image upload for @mira',
        sourceRef: 'realm-agent-studio.reviewed-identity-media-resource',
        metadata: expect.objectContaining({
          source: 'realm-agent-studio.reviewed-identity-media-resource',
          attachmentPurpose: 'identity',
          humanReviewed: true,
        }),
        tags: ['realm-agent-studio', 'identity-candidate'],
      }));
      expect(collectKeys(finalizePayload).has('WorldControlService')).toBe(false);
      expect(collectKeys(finalizePayload).has('bindingSuccess')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: 'Realm ResourcesService direct upload + finalizeResource',
        attachmentTruth: true,
        publicTruth: false,
        canonical: {
          id: 'resource-image-upload',
          resourceType: 'IMAGE',
          status: 'READY',
        },
      });
    });

     it('fails closed before direct upload for mismatched media file types', async () => {
      const realm = mockRealm();
      const result = await uploadReviewedPostMediaResource({
        resourceType: 'VIDEO',
        file: { name: 'not-video.png', type: 'image/png', size: 10 },
        agent: ownerAgentDetail(),
      }, realm, vi.fn(async () => undefined));

      expect(realm.services.ResourcesService.createVideoDirectUpload).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        failure: 'media-upload-file-invalid',
        submitted: null,
      });
    });

     it('fails closed when Realm direct upload session creation throws', async () => {
      const realm = mockRealm();
      vi.mocked(realm.services.ResourcesService.createImageDirectUpload).mockRejectedValueOnce(new Error('Cloudflare unavailable'));

      const result = await uploadReviewedPostMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
        agent: ownerAgentDetail(),
      }, realm, vi.fn(async () => undefined));

      expect(realm.services.ResourcesService.finalizeResource).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        failure: 'realm-direct-upload-session-failed',
        message: 'Cloudflare unavailable',
      });
    });

     it('fails closed when Realm direct upload session is not a PENDING matching Resource', async () => {
      const realm = mockRealm();
      vi.mocked(realm.services.ResourcesService.createImageDirectUpload).mockResolvedValueOnce({
        resourceId: 'resource-wrong',
        resourceType: 'VIDEO',
        provider: 'CF_STREAM',
        storageRef: 'wrong',
        uploadUrl: 'https://upload.example.test/wrong',
        status: 'PENDING',
        deliveryAccess: 'SIGNED',
      });

      const result = await uploadReviewedPostMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
        agent: ownerAgentDetail(),
      }, realm, vi.fn(async () => undefined));

      expect(realm.services.ResourcesService.finalizeResource).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        failure: 'realm-direct-upload-session-invalid',
      });
    });

     it('fails closed when storage direct upload fails before finalize', async () => {
      const realm = mockRealm();
      const storageUpload = vi.fn(async () => {
        throw new Error('storage rejected upload');
      });

      const result = await uploadReviewedPostMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
        agent: ownerAgentDetail(),
      }, realm, storageUpload);

      expect(realm.services.ResourcesService.finalizeResource).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        failure: 'storage-direct-upload-failed',
        message: 'storage rejected upload',
      });
    });

     it('fails closed when finalizeResource throws after storage upload', async () => {
      const realm = mockRealm();
      vi.mocked(realm.services.ResourcesService.finalizeResource).mockRejectedValueOnce(new Error('finalize rejected'));

      const result = await uploadReviewedPostMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
        agent: ownerAgentDetail(),
      }, realm, vi.fn(async () => undefined));

      expect(result).toMatchObject({
        ok: false,
        failure: 'realm-finalize-resource-failed',
        message: 'finalize rejected',
      });
    });

     it('fails closed when finalizeResource returns a non-ready media Resource', async () => {
      const realm = mockRealm();
      vi.mocked(realm.services.ResourcesService.finalizeResource).mockResolvedValueOnce({
        id: 'resource-image-upload',
        resourceType: 'IMAGE',
        provider: 'CF_IMAGE',
        status: 'PENDING',
        storageRef: 'resource-image-upload',
        provenance: 'UPLOADED',
        uploaderAccountId: 'user-1',
        controllerKind: 'ACCOUNT',
        controllerId: 'user-1',
        deliveryAccess: 'SIGNED',
        tags: [],
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      });

      const result = await uploadReviewedPostMediaResource({
        resourceType: 'IMAGE',
        file: { name: 'portrait.png', type: 'image/png', size: 2048 },
        agent: ownerAgentDetail(),
      }, realm, vi.fn(async () => undefined));

      expect(result).toMatchObject({
        ok: false,
        failure: 'realm-finalize-resource-not-ready',
      });
    });

     it('fails closed when finalized direct media Resource is not READY', () => {
      expect(buildFinalizeDirectMediaResourceInput({
        resourceType: 'VIDEO',
        file: { name: 'clip.mp4', type: 'video/mp4', size: 1024 },
        agent: ownerAgentDetail(),
      })).toMatchObject({
        agentId: 'agent-1',
        mimeType: 'video/mp4',
      });
      expect(normalizeFinalizedDirectMediaResource({
        id: 'resource-video-upload',
        resourceType: 'VIDEO',
        status: 'PENDING',
      } as Awaited<ReturnType<Realm['services']['ResourcesService']['finalizeResource']>>, 'VIDEO')).toBeNull();
    });

     it('fails closed before text Resource creation when reviewed caption content is missing', async () => {
      const realm = mockRealm();
      const result = await createReviewedPostTextResource({
        ...candidatePayload,
        realmCreatePost: {
          attachments: [],
        },
      }, realm);

      expect(realm.services.ResourcesService.createTextResource).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        source: 'Realm ResourcesService.createTextResource',
        attachmentTruth: false,
        failure: 'post-text-resource-payload-invalid',
        submitted: null,
      });
    });

     it('fails closed when text Resource creation does not return a READY TEXT resource', () => {
      const submitted = buildRealmPostTextResourceInput(candidatePayload);
      expect(submitted).not.toBeNull();

      const result = normalizeRealmTextResourceCreateResult({
        id: 'resource-image-1',
        resourceType: 'IMAGE',
        status: 'PENDING',
      } as Awaited<ReturnType<Realm['services']['ResourcesService']['createTextResource']>>, submitted!);

      expect(result).toMatchObject({
        ok: false,
        source: 'Realm ResourcesService.createTextResource',
        attachmentTruth: false,
        failure: 'realm-create-text-resource-not-ready',
        submitted,
      });
    });

     it('normalizes Create Post responses without canonical id as publish failure', () => {
      const result = normalizeRealmPostPublishResult({} as Awaited<ReturnType<Realm['services']['PostsService']['createPost']>>);

      expect(result).toMatchObject({
        ok: false,
        failure: 'realm-create-post-missing-canonical-id',
      });
    });

     it('builds CreatePostDto shape from reviewed payload only', () => {
      const input = buildRealmCreatePostInput(candidatePayload);

      expect(input).toEqual(candidatePayload.realmCreatePost);
      expect(collectKeys(input).has('agentRef')).toBe(false);
      expect(collectKeys(input).has('review')).toBe(false);
    });

     it('uses Runtime text.generate for candidate post copy only', async () => {
      vi.stubEnv('VITE_RUNTIME_POST_COPY_MODEL', 'configured-post-model');
      const generatePostCopy = vi.fn(async (_input: unknown) => ({
        text: JSON.stringify({
          caption: 'Mira shares a concise artifact update.',
          tagsText: ['artifact', 'studio'],
          rationale: 'Owner asked for a concise update.',
        }),
        finishReason: 'stop' as const,
        usage: { inputTokens: 1, outputTokens: 1 },
        trace: { traceId: 'trace-post-copy', modelResolved: 'configured-post-model' },
      }));
      const runtime = {
        ai: {
          text: {
            generate: generatePostCopy,
          },
        },
      };

      const result = await proposeReviewedPostCopy(ownerAgentDetail(), {
        caption: '',
        tagsText: '',
        humanReviewed: false,
        attachmentEnabled: false,
        attachmentTargetType: 'RESOURCE',
        attachmentTargetId: '',
      }, 'Draft a short launch post.', runtime);
      const submittedPayload = generatePostCopy.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

      expect(generatePostCopy).toHaveBeenCalledTimes(1);
      expect(submittedPayload).toMatchObject({
        model: 'configured-post-model',
        metadata: {
          domain: 'realm-agent-studio.post-copy',
        },
      });
      expect(collectKeys(submittedPayload).has('provider')).toBe(false);
      expect(String(submittedPayload?.input || '')).not.toContain('LocalAgent');
      expect(String(submittedPayload?.input || '')).not.toContain('worldId');
      expect(result).toMatchObject({
        ok: true,
        source: 'Runtime runtime.ai.text.generate',
        candidate: true,
        truthWrite: false,
        proposal: {
          draftPatch: {
            caption: 'Mira shares a concise artifact update.',
            tagsText: 'artifact, studio',
          },
        },
        runtime: {
          traceId: 'trace-post-copy',
        },
      });
      vi.unstubAllEnvs();
    });

     it('fails closed for Runtime post copy when model config is missing', async () => {
      vi.stubEnv('VITE_RUNTIME_POST_COPY_MODEL', '');
      vi.stubEnv('VITE_RUNTIME_TEXT_MODEL', '');
      const runtime = {
        ai: {
          text: {
            generate: vi.fn(),
          },
        },
      };

      const result = await proposeReviewedPostCopy(ownerAgentDetail(), {
        caption: '',
        tagsText: '',
        humanReviewed: false,
        attachmentEnabled: false,
        attachmentTargetType: 'RESOURCE',
        attachmentTargetId: '',
      }, 'Draft a short launch post.', runtime);

      expect(runtime.ai.text.generate).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        source: 'Runtime runtime.ai.text.generate',
        candidate: false,
        truthWrite: false,
        failure: 'runtime-post-copy-payload-invalid',
        message: 'Runtime runtime.ai.text.generate model config missing',
      });
      vi.unstubAllEnvs();
    });
});
