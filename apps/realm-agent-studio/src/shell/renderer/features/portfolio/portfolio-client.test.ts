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

describe('owner portfolio core client', () => {
    it('uses listMyRealmAgents only for portfolio list data', async () => {
      const realm = mockRealm();
      const agents = await listOwnerPortfolioAgents(realm);

      expect(realm.services.MeService.listMyRealmAgents).toHaveBeenCalledTimes(1);
      expect(realm.services.MeService.getMyRealmAgent).not.toHaveBeenCalled();
      expect(agents[0]?.source).toBe('Realm MeService.listMyRealmAgents');
    });

     it('fetches selected detail through getMyRealmAgent', async () => {
      const realm = mockRealm();
      const detail = await getOwnerPortfolioAgentDetail('agent-detail-1', realm);

      expect(realm.services.MeService.getMyRealmAgent).toHaveBeenCalledWith('agent-detail-1');
      expect(realm.services.MeService.listMyRealmAgents).not.toHaveBeenCalled();
      expect(detail.id).toBe('agent-detail-1');
      expect(detail.bio.value).toBe('Detail bio');
      expect(detail.source).toBe('Realm MeService.getMyRealmAgent');
    });

     it('uses WorldsService only for create readiness world list reads', async () => {
      const realm = mockRealm();
      const worlds = await listCreateRealmAgentSelectableWorlds(realm);

      expect(realm.services.WorldsService.worldControllerListWorlds).toHaveBeenCalledTimes(1);
      expect(realm.services.AgentsService.agentControllerCreate).not.toHaveBeenCalled();
      expect(worlds[0]).toMatchObject({
        id: 'world-oasis',
        source: 'Realm WorldsService.worldControllerListWorlds',
      });
    });

     it('uses WorldsService detail-with-agents for selected world preview', async () => {
      const realm = mockRealm();
      const preview = await getCreateRealmAgentWorldPreview('world-oasis', realm);

      expect(realm.services.WorldsService.worldControllerGetWorldDetailWithAgents).toHaveBeenCalledWith('world-oasis', 4);
      expect(realm.services.AgentsService.agentControllerCreate).not.toHaveBeenCalled();
      expect(preview.source).toBe('Realm WorldsService.worldControllerGetWorldDetailWithAgents');
    });

     it('checks create handle availability through AgentsService before create', async () => {
      const realm = mockRealm();
      const available = await checkCreateRealmAgentHandleAvailability(' @Mira.Agent ', realm);
      const unavailable = await checkCreateRealmAgentHandleAvailability('taken.agent', realm);

      expect(realm.services.AgentsService.agentControllerCheckHandle).toHaveBeenCalledWith('mira.agent');
      expect(realm.services.AgentsService.agentControllerCheckHandle).toHaveBeenCalledWith('taken.agent');
      expect(available).toMatchObject({
        ok: true,
        truthWrite: false,
        availability: {
          source: 'Realm AgentsService.agentControllerCheckHandle',
          handle: 'mira.agent',
          normalized: 'mira.agent',
          available: true,
        },
      });
      expect(unavailable).toMatchObject({
        ok: true,
        truthWrite: false,
        availability: {
          handle: 'taken.agent',
          available: false,
          message: 'Handle already taken.',
        },
      });
      expect(realm.services.AgentsService.agentControllerCreate).not.toHaveBeenCalled();
      expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
    });

     it('creates a Realm Agent through AgentsService.agentControllerCreate with CreateAgentDto allowlist only', async () => {
      const realm = mockRealm();
      const result = await createReviewedRealmAgent(createPayload, realm);
      const createAgent = realm.services.AgentsService.agentControllerCreate;
      const submittedPayload = vi.mocked(createAgent).mock.calls[0]?.[0];

      expect(createAgent).toHaveBeenCalledTimes(1);
      expect(submittedPayload).toEqual(createPayload.body);
      expect(Object.keys(submittedPayload || {}).sort()).toEqual([
        'concept',
        'description',
        'displayName',
        'handle',
        'ownershipType',
        'rules',
        'worldId',
      ]);
      expect(collectKeys(submittedPayload).has('publicBio')).toBe(false);
      expect(collectKeys(submittedPayload).has('id')).toBe(false);
      expect(collectKeys(submittedPayload).has('authorId')).toBe(false);
      expect(collectKeys(submittedPayload).has('ownerId')).toBe(false);
      expect(collectKeys(submittedPayload).has('creatorId')).toBe(false);
      expect(collectKeys(submittedPayload).has('maintainerId')).toBe(false);
      expect(collectKeys(submittedPayload).has('state')).toBe(false);
      expect(collectKeys(submittedPayload).has('lifecycle')).toBe(false);
      expect(collectKeys(submittedPayload).has('provider')).toBe(false);
      expect(collectKeys(submittedPayload).has('model')).toBe(false);
      expect(collectKeys(submittedPayload).has('LocalAgent')).toBe(false);
      expect(collectKeys(submittedPayload).has('dna')).toBe(false);
      expect(collectKeys(submittedPayload).has('dnaPrimary')).toBe(false);
      expect(collectKeys(submittedPayload).has('dnaSecondary')).toBe(false);
      expect(collectKeys(submittedPayload).has('referenceImageUrl')).toBe(false);
      expect(result).toMatchObject({
        ok: true,
        source: REALM_AGENT_CREATE_SOURCE,
        canonical: {
          id: 'agent-created-1',
          state: 'INCUBATING',
        },
      });
    });

     it('does not require or call a Creator service for create reads or writes', async () => {
      const realm = mockRealm();

      expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
      await listCreateRealmAgentSelectableWorlds(realm);
      await getCreateRealmAgentWorldPreview('world-oasis', realm);
      await createReviewedRealmAgent(createPayload, realm);

      expect(realm.services.AgentsService.agentControllerCreate).toHaveBeenCalledTimes(1);
    });

     it('creates audio upload session with metadata and finalizes after storage upload', async () => {
      const realm = mockRealm();
      const storageUpload = vi.fn(async () => undefined);
      const result = await uploadReviewedPostMediaResource({
        resourceType: 'AUDIO',
        file: { name: 'voice.mp3', type: 'audio/mpeg', size: 4096 },
        agent: ownerAgentDetailWithWorldId(),
      }, realm, storageUpload);
      const audioPayload = vi.mocked(realm.services.ResourcesService.createAudioDirectUpload).mock.calls[0]?.[0];

      expect(audioPayload).toMatchObject({
        agentId: 'agent-1',
        filename: 'voice.mp3',
        mimeType: 'audio/mpeg',
        metadata: {
          source: 'realm-agent-studio.reviewed-post-media-resource',
          resourceType: 'AUDIO',
        },
      });
      expect(storageUpload).toHaveBeenCalledWith({
        uploadUrl: 'https://upload.example.test/audio',
        resourceType: 'AUDIO',
        file: { name: 'voice.mp3', type: 'audio/mpeg', size: 4096 },
      });
      expect(result).toMatchObject({
        ok: true,
        canonical: {
          id: 'resource-audio-upload',
          resourceType: 'AUDIO',
          status: 'READY',
        },
      });
    });

     it('normalizes Create Agent responses without canonical id as create failure', () => {
      const result = normalizeRealmAgentCreateResult({} as Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerCreate']>>);

      expect(result).toMatchObject({
        ok: false,
        source: REALM_AGENT_CREATE_SOURCE,
        failure: 'realm-create-agent-missing-canonical-id',
      });
    });

     it('builds CreateAgentDto shape from reviewed payload body only', () => {
      const input = buildRealmCreateAgentInput(createPayload);

      expect(input).toEqual(createPayload.body);
      expect(collectKeys(input).has('publicFields')).toBe(false);
      expect(collectKeys(input).has('path')).toBe(false);
      expect(collectKeys(input).has('source')).toBe(false);
    });

     it('rebuilds CreateAgentDto from a narrow allowlist and forces MASTER_OWNED at submit boundary', () => {
      const dirtyPayload = {
        ...createPayload,
        body: {
          ...createPayload.body,
          ownershipType: 'WORLD_OWNED',
          dna: { hidden: true },
          dnaPrimary: 'MYSTERIOUS',
          dnaSecondary: ['CALM'],
          referenceImageUrl: 'https://cdn.example.test/reference.png',
          lifecycle: 'ACTIVE',
          provider: 'forbidden',
          model: 'forbidden',
          ownerId: 'owner-1',
        },
      } as unknown as ReviewedCreateRealmAgentPayload;
      const input = buildRealmCreateAgentInput(dirtyPayload);

      expect(input).toEqual(createPayload.body);
      expect(input.ownershipType).toBe('MASTER_OWNED');
      expect(collectKeys(input).has('dna')).toBe(false);
      expect(collectKeys(input).has('dnaPrimary')).toBe(false);
      expect(collectKeys(input).has('dnaSecondary')).toBe(false);
      expect(collectKeys(input).has('referenceImageUrl')).toBe(false);
      expect(collectKeys(input).has('lifecycle')).toBe(false);
      expect(collectKeys(input).has('provider')).toBe(false);
      expect(collectKeys(input).has('model')).toBe(false);
      expect(collectKeys(input).has('ownerId')).toBe(false);
    });

     it('fails closed when Runtime Tauri IPC transport is unavailable', async () => {
      const result = await synthesizeReviewedVoiceDemo({
        scriptText: 'Welcome in.',
        model: 'runtime-tts-model',
      }, ownerAgentDetail(), null);

      expect(result).toMatchObject({
        ok: false,
        source: 'Runtime media.tts.synthesize',
        failure: 'runtime-transport-unavailable',
        message: 'Runtime media.tts.synthesize runtime transport unavailable: Tauri IPC runtime transport is required.',
      });
      expect(result.draft).toMatchObject({
        candidate: true,
        publicTruth: false,
      });
    });
});
