import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
import {
  ForgeEmptyState,
  ForgeErrorBanner,
  ForgeLoadingSpinner,
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeStatCard,
} from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { LabeledSelectField, LabeledTextField, LabeledTextareaField } from '@renderer/components/form-fields.js';
import type { DesignedVoiceAsset } from '@renderer/data/enrichment-client.js';
import { useResourcesQuery, type ResourceSummary } from '@renderer/hooks/use-content-queries.js';
import {
  useAgentAssetOps,
  type AgentAssetOpsCandidateView,
  type AgentAssetOpsFamily,
} from '@renderer/hooks/use-agent-asset-ops.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

const FAMILY_COPY: Record<AgentAssetOpsFamily, {
  title: string;
  description: string;
  studioTarget: 'agent-avatar' | 'agent-portrait' | null;
}> = {
  'agent-avatar': {
    title: 'Agent Avatar Review',
    description: 'Review square avatar candidates, confirm a winner, and write it into the active agent avatar seam.',
    studioTarget: 'agent-avatar',
  },
  'agent-cover': {
    title: 'Agent Cover Review',
    description: 'Review portrait cover candidates, confirm a winner, and bind it through the agent cover seam.',
    studioTarget: 'agent-portrait',
  },
  'agent-greeting-primary': {
    title: 'Primary Greeting Review',
    description: 'Review greeting text candidates, confirm the selected opening line, and bind it as the active greeting.',
    studioTarget: null,
  },
  'agent-voice-demo': {
    title: 'Voice Demo Review',
    description: 'Review playable voice-demo candidates, confirm the selected sample, and bind it when the seam is available.',
    studioTarget: null,
  },
};

const LIFECYCLE_TONE = {
  generated: 'info',
  candidate: 'warning',
  approved: 'success',
  rejected: 'danger',
  confirmed: 'warning',
  bound: 'success',
  superseded: 'neutral',
} as const;

export default function AgentAssetFamilyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { agentId = '', family = '' } = useParams<{ agentId: string; family: string }>();
  const normalizedFamily = isAgentAssetFamily(family) ? family : null;
  const safeFamily: AgentAssetOpsFamily = normalizedFamily ?? 'agent-avatar';
  const assetOps = useAgentAssetOps(agentId);
  const worldQuery = useWorldDetailQuery(assetOps.worldId);
  const resourcesQuery = useResourcesQuery(Boolean(agentId));
  const [manualGreeting, setManualGreeting] = useState('');
  const [voiceDemoText, setVoiceDemoText] = useState('');
  const [voiceDemoLanguage, setVoiceDemoLanguage] = useState('');
  const [selectedVoiceAssetId, setSelectedVoiceAssetId] = useState('');
  const [voiceDesignInstructionText, setVoiceDesignInstructionText] = useState('');
  const [voiceDesignPreviewText, setVoiceDesignPreviewText] = useState('');
  const [voiceDesignLanguage, setVoiceDesignLanguage] = useState('');
  const [voiceDesignPreferredName, setVoiceDesignPreferredName] = useState('');
  const [adoptionError, setAdoptionError] = useState<string | null>(null);
  const hydratedResourceIdsRef = useRef<Set<string>>(new Set());

  const agent = assetOps.agentQuery.data;
  const familyCopy = FAMILY_COPY[safeFamily];
  const familyState = assetOps.getFamilyState(safeFamily);
  const highlightedResourceId = searchParams.get('candidateResourceId') || '';
  const libraryImages = useMemo(() => {
    const existingResourceIds = new Set(
      familyState.candidateList
        .map((candidate) => candidate.resourceId)
        .filter((candidateId): candidateId is string => Boolean(candidateId)),
    );
    return (resourcesQuery.data || [])
      .filter((resource) => resource.resourceType === 'IMAGE' && Boolean(resource.url))
      .filter((resource) => !existingResourceIds.has(resource.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  }, [familyState.candidateList, resourcesQuery.data]);
  const libraryAudio = useMemo(() => {
    const existingResourceIds = new Set(
      familyState.candidateList
        .map((candidate) => candidate.resourceId)
        .filter((candidateId): candidateId is string => Boolean(candidateId)),
    );
    return (resourcesQuery.data || [])
      .filter((resource) => resource.resourceType === 'AUDIO')
      .filter((resource) => !existingResourceIds.has(resource.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  }, [familyState.candidateList, resourcesQuery.data]);

  const queuedGreetingText = manualGreeting.trim();
  const greetingFamilyState = assetOps.getFamilyState('agent-greeting-primary');
  const fallbackVoiceDemoText = String(
    greetingFamilyState.confirmedItem?.text
    || greetingFamilyState.currentBoundItem?.text
    || '',
  ).trim();
  const designedVoiceAssets = assetOps.designedVoiceAssetsQuery.data || [];
  const selectedDesignedVoice = designedVoiceAssets.find((asset) => asset.voiceAssetId === selectedVoiceAssetId) || null;

  useEffect(() => {
    if (!normalizedFamily || !highlightedResourceId || hydratedResourceIdsRef.current.has(highlightedResourceId)) {
      return;
    }
    if (normalizedFamily !== 'agent-avatar' && normalizedFamily !== 'agent-cover' && normalizedFamily !== 'agent-voice-demo') {
      return;
    }
    const resource = (resourcesQuery.data || []).find((item) => item.id === highlightedResourceId);
    if (!resource) {
      return;
    }
    assetOps.addResourceCandidate({
      family: normalizedFamily,
      resourceId: resource.id,
      previewUrl: resource.url,
      mimeType: inferMimeType(resource),
      origin: 'library',
    });
    hydratedResourceIdsRef.current.add(highlightedResourceId);
  }, [assetOps, highlightedResourceId, normalizedFamily, resourcesQuery.data]);

  useEffect(() => {
    if (normalizedFamily !== 'agent-voice-demo') {
      return;
    }
    if (!voiceDemoText && fallbackVoiceDemoText) {
      setVoiceDemoText(fallbackVoiceDemoText);
    }
    if (!voiceDesignPreviewText && fallbackVoiceDemoText) {
      setVoiceDesignPreviewText(fallbackVoiceDemoText);
    }
  }, [fallbackVoiceDemoText, normalizedFamily, voiceDemoText, voiceDesignPreviewText]);

  useEffect(() => {
    const latestDesignedVoice = assetOps.designCustomVoiceMutation.data;
    if (latestDesignedVoice?.voiceAssetId && latestDesignedVoice.voiceAssetId !== selectedVoiceAssetId) {
      setSelectedVoiceAssetId(latestDesignedVoice.voiceAssetId);
      return;
    }
    if (!selectedVoiceAssetId && designedVoiceAssets[0]?.voiceAssetId) {
      setSelectedVoiceAssetId(designedVoiceAssets[0].voiceAssetId);
    }
  }, [assetOps.designCustomVoiceMutation.data, designedVoiceAssets, selectedVoiceAssetId]);

  if (!agentId) {
    return <ForgeEmptyState message="No agent ID provided." />;
  }

  if (!normalizedFamily) {
    return <ForgeEmptyState message="Unsupported agent asset family." />;
  }

  if (assetOps.agentQuery.isLoading || resourcesQuery.isLoading || assetOps.bindingsQuery.isLoading || (assetOps.worldId && worldQuery.isLoading)) {
    return <ForgeLoadingSpinner />;
  }

  if (!agent) {
    return <ForgeEmptyState message="Agent not found." />;
  }

  const activePreviewUrl = familyState.activeItem?.previewUrl;
  const activeText = familyState.activeItem?.text;
  const bindUnavailable = !familyState.bindSupport.supported;
  const queueCount =
    familyState.counts.generated
    + familyState.counts.candidate
    + familyState.counts.approved
    + familyState.counts.confirmed;
  const studioPath = familyCopy.studioTarget
    ? buildStudioPath({
        agentId,
        target: familyCopy.studioTarget,
        agentName: agent.displayName || agent.handle,
        worldId: agent.worldId || null,
        worldName: worldQuery.data?.name || null,
      })
    : null;
  const canAdoptCurrentDirectField =
    (normalizedFamily === 'agent-avatar' || normalizedFamily === 'agent-greeting-primary')
    && Boolean(familyState.currentBoundItem?.isSynthetic);
  const adoptableCurrentFamily = canAdoptCurrentDirectField ? normalizedFamily : null;

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={familyCopy.title}
        subtitle={familyCopy.description}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate(`/agents/${agentId}/assets`)}>
              Back to Asset Hub
            </Button>
            {studioPath ? (
              <Button tone="secondary" size="sm" onClick={() => navigate(studioPath)}>
                Generate Candidate
              </Button>
            ) : normalizedFamily === 'agent-greeting-primary' ? (
              <Button
                tone="secondary"
                size="sm"
                onClick={() =>
                  void assetOps.generateGreetingCandidateMutation.mutateAsync({
                    worldName: worldQuery.data?.name,
                    worldDescription: worldQuery.data?.description ?? undefined,
                  })
                }
                disabled={assetOps.generateGreetingCandidateMutation.isPending}
              >
                {assetOps.generateGreetingCandidateMutation.isPending ? 'Generating...' : 'Generate Greeting Candidate'}
              </Button>
            ) : null}
          </div>
        )}
      />

      {assetOps.bindConfirmedMutation.isError ? (
        <ForgeErrorBanner
          message={assetOps.bindConfirmedMutation.error instanceof Error ? assetOps.bindConfirmedMutation.error.message : 'Failed to bind the confirmed candidate.'}
        />
      ) : null}
      {assetOps.generateGreetingCandidateMutation.isError ? (
        <ForgeErrorBanner
          message={assetOps.generateGreetingCandidateMutation.error instanceof Error ? assetOps.generateGreetingCandidateMutation.error.message : 'Failed to generate greeting candidate.'}
        />
      ) : null}
      {assetOps.generateVoiceDemoCandidateMutation.isError ? (
        <ForgeErrorBanner
          message={assetOps.generateVoiceDemoCandidateMutation.error instanceof Error ? assetOps.generateVoiceDemoCandidateMutation.error.message : 'Failed to synthesize voice demo candidate.'}
        />
      ) : null}
      {assetOps.designCustomVoiceMutation.isError ? (
        <ForgeErrorBanner
          message={assetOps.designCustomVoiceMutation.error instanceof Error ? assetOps.designCustomVoiceMutation.error.message : 'Failed to design custom voice asset.'}
        />
      ) : null}
      {adoptionError ? (
        <ForgeErrorBanner message={adoptionError} />
      ) : null}
      {assetOps.designedVoiceAssetsQuery.isError ? (
        <ForgeErrorBanner
          message={assetOps.designedVoiceAssetsQuery.error instanceof Error ? assetOps.designedVoiceAssetsQuery.error.message : 'Failed to load designed voice assets.'}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <ForgeStatCard
          label="Current Winner"
          value={familyState.currentBoundItem ? 'Bound' : familyState.confirmedItem ? 'Confirmed' : 'Missing'}
          detail="The active family winner from confirmation and bind state."
        />
        <ForgeStatCard
          label="Candidate Queue"
          value={queueCount}
          detail="Candidates still moving through review, confirmation, or bind."
        />
        <ForgeStatCard
          label="Rejected"
          value={familyState.counts.rejected}
          detail="Rejected candidates remain visible for explicit review history."
        />
        <ForgeStatCard
          label="Bind Support"
          value={familyState.bindSupport.supported ? 'Ready' : 'Unavailable'}
          detail={familyState.bindSupport.supported ? 'This family can bind through its admitted seam.' : familyState.bindSupport.reason || 'Bind support is unavailable.'}
        />
      </div>

      {bindUnavailable ? (
        <ForgeSection>
          <Surface tone="card" material="glass-thin" elevation="base" padding="md">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">Bind unavailable</p>
            <p className="mt-2 text-sm text-[var(--nimi-text-muted)]">
              {familyState.bindSupport.reason || 'This family cannot bind on the current agent.'}
            </p>
          </Surface>
        </ForgeSection>
      ) : null}

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Current"
          title="Active Family Posture"
          description="This surface owns review, confirmation, and bind. Agent detail remains a handoff surface."
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
            {activePreviewUrl ? (
              normalizedFamily === 'agent-voice-demo' ? (
                <audio controls className="w-full">
                  <source src={activePreviewUrl} />
                </audio>
              ) : (
                <img
                  src={activePreviewUrl}
                  alt=""
                  className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${normalizedFamily === 'agent-cover' ? 'aspect-[9/16] max-h-[420px]' : 'aspect-square max-h-[340px]'}`}
                />
              )
            ) : activeText ? (
              <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="min-h-40">
                <p className="text-sm leading-6 text-[var(--nimi-text-primary)]">{activeText}</p>
              </Surface>
            ) : (
              <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${normalizedFamily === 'agent-cover' ? 'aspect-[9/16] max-h-[420px]' : 'aspect-square max-h-[340px]'}`}>
                <ForgeEntityAvatar name={agent.displayName || agent.handle} size="lg" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <ForgeStatusBadge
                domain="generic"
                status={familyState.currentBoundItem ? 'BOUND' : familyState.confirmedItem ? 'CONFIRMED' : 'MISSING'}
                label={familyState.currentBoundItem ? 'Bound' : familyState.confirmedItem ? 'Confirmed' : 'Missing'}
                tone={familyState.currentBoundItem ? 'success' : familyState.confirmedItem ? 'warning' : 'danger'}
              />
              {familyState.activeItem?.resourceId ? (
                <ForgeStatusBadge
                  domain="generic"
                  status="PRESENT"
                  label={`Resource ${familyState.activeItem.resourceId.slice(0, 8)}`}
                  tone="info"
                />
              ) : null}
            </div>
            {canAdoptCurrentDirectField ? (
              <Surface tone="card" material="glass-thin" elevation="base" padding="sm" className="space-y-3">
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  The current {normalizedFamily === 'agent-avatar' ? 'avatar' : 'greeting'} is live on the agent record but not yet represented in local asset-ops state. Adopt it here before using it as explicit publish truth.
                </p>
                <Button
                  tone="secondary"
                  size="sm"
                  onClick={() => {
                    try {
                      setAdoptionError(null);
                      assetOps.adoptCurrentFieldCandidate(adoptableCurrentFamily!);
                    } catch (error) {
                      setAdoptionError(error instanceof Error ? error.message : 'Failed to adopt current field into agent asset ops.');
                    }
                  }}
                >
                  {normalizedFamily === 'agent-avatar' ? 'Adopt Current Avatar' : 'Adopt Current Greeting'}
                </Button>
              </Surface>
            ) : null}
          </Surface>

          <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-3">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">Lifecycle Grammar</p>
            <p className="text-sm text-[var(--nimi-text-muted)]">
              `candidate` enters review, `approved` marks acceptable quality, `confirmed` selects the winner, and `bound` proves the canonical seam changed.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <LifecycleCounter label="Generated" value={familyState.counts.generated} />
              <LifecycleCounter label="Candidate" value={familyState.counts.candidate} />
              <LifecycleCounter label="Approved" value={familyState.counts.approved} />
              <LifecycleCounter label="Confirmed" value={familyState.counts.confirmed} />
            </div>
          </Surface>
        </div>
      </ForgeSection>

      {normalizedFamily === 'agent-voice-demo' ? (
        <ForgeSection className="space-y-4">
          <ForgeSectionHeading
            eyebrow="Synthesis"
            title="Voice Demo Synthesis"
            description="Plain synthesis stays on audio.synthesize. Designed voices stay explicit and only run when an independent voice-design binding is configured."
          />
          <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
            <LabeledTextareaField
              label="Voice Demo Text"
              value={voiceDemoText}
              onChange={setVoiceDemoText}
              rows={4}
              placeholder="Enter the line to synthesize for the next voice demo candidate..."
              helper="This text becomes the next generated voice-demo candidate."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledTextField
                label="Language"
                value={voiceDemoLanguage}
                onChange={setVoiceDemoLanguage}
                placeholder="Language hint (optional)"
                helper="Passed to plain synthesis and designed-voice synthesis when provided."
              />
              <LabeledSelectField
                label="Designed Voice"
                value={selectedVoiceAssetId}
                onChange={setSelectedVoiceAssetId}
                placeholder="Choose a designed voice asset"
                disabled={!assetOps.customVoiceSupport.supported || assetOps.designedVoiceAssetsQuery.isLoading}
                helper={assetOps.customVoiceSupport.supported
                  ? 'Select a designed voice asset before synthesizing through the custom-voice path.'
                  : assetOps.customVoiceSupport.reason || 'Custom voice design is unavailable.'}
                options={[
                  { value: '', label: assetOps.designedVoiceAssetsQuery.isLoading ? 'Loading designed voices...' : 'No designed voice selected' },
                  ...designedVoiceAssets.map((asset) => ({
                    value: asset.voiceAssetId,
                    label: formatDesignedVoiceLabel(asset),
                  })),
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="secondary"
                size="sm"
                onClick={() =>
                  void assetOps.generateVoiceDemoCandidateMutation.mutateAsync({
                    text: voiceDemoText.trim() || fallbackVoiceDemoText,
                    language: voiceDemoLanguage.trim() || undefined,
                  })
                }
                disabled={assetOps.generateVoiceDemoCandidateMutation.isPending || !(voiceDemoText.trim() || fallbackVoiceDemoText)}
              >
                {assetOps.generateVoiceDemoCandidateMutation.isPending ? 'Synthesizing...' : 'Synthesize Plain Demo'}
              </Button>
              <Button
                tone="primary"
                size="sm"
                onClick={() =>
                  void assetOps.generateVoiceDemoCandidateMutation.mutateAsync({
                    text: voiceDemoText.trim() || fallbackVoiceDemoText,
                    language: voiceDemoLanguage.trim() || undefined,
                    voiceAssetId: selectedVoiceAssetId || undefined,
                  })
                }
                disabled={
                  assetOps.generateVoiceDemoCandidateMutation.isPending
                  || !assetOps.customVoiceSupport.supported
                  || !selectedVoiceAssetId
                  || !(voiceDemoText.trim() || fallbackVoiceDemoText)
                }
              >
                {assetOps.generateVoiceDemoCandidateMutation.isPending ? 'Synthesizing...' : 'Synthesize With Designed Voice'}
              </Button>
            </div>
            {!assetOps.customVoiceSupport.supported ? (
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                {assetOps.customVoiceSupport.reason}
              </p>
            ) : selectedDesignedVoice ? (
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                Selected voice asset: {formatDesignedVoiceLabel(selectedDesignedVoice)}.
              </p>
            ) : (
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                Design a custom voice below or pick an existing voice asset before using the custom synthesis path.
              </p>
            )}
          </Surface>
        </ForgeSection>
      ) : null}

      {normalizedFamily === 'agent-voice-demo' ? (
        <ForgeSection className="space-y-4">
          <ForgeSectionHeading
            eyebrow="Voice Design"
            title="Custom Voice Design"
            description="Submit instruction_text and preview_text to the admitted VOICE_DESIGN workflow, wait for completion, then reuse the fetched voice asset for later syntheses on this page."
          />
          <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
            <LabeledTextareaField
              label="Instruction Text"
              value={voiceDesignInstructionText}
              onChange={setVoiceDesignInstructionText}
              rows={4}
              placeholder="Describe the designed voice: tone, pacing, emotional range, clarity, recording style..."
              helper="This goes directly to the custom voice design workflow."
            />
            <LabeledTextareaField
              label="Preview Text"
              value={voiceDesignPreviewText}
              onChange={setVoiceDesignPreviewText}
              rows={3}
              placeholder="Preview text used to audition the designed voice..."
              helper="Required by the admitted text-to-voice design workflow."
            />
            <div className="grid gap-4 md:grid-cols-2">
              <LabeledTextField
                label="Language"
                value={voiceDesignLanguage}
                onChange={setVoiceDesignLanguage}
                placeholder="Language (optional)"
              />
              <LabeledTextField
                label="Preferred Name"
                value={voiceDesignPreferredName}
                onChange={setVoiceDesignPreferredName}
                placeholder="Preferred voice asset name (optional)"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="primary"
                size="sm"
                onClick={() =>
                  void assetOps.designCustomVoiceMutation.mutateAsync({
                    instructionText: voiceDesignInstructionText,
                    previewText: voiceDesignPreviewText,
                    language: voiceDesignLanguage.trim() || undefined,
                    preferredName: voiceDesignPreferredName.trim() || undefined,
                  })
                }
                disabled={
                  assetOps.designCustomVoiceMutation.isPending
                  || !assetOps.customVoiceSupport.supported
                  || !voiceDesignInstructionText.trim()
                  || !voiceDesignPreviewText.trim()
                }
              >
                {assetOps.designCustomVoiceMutation.isPending ? 'Designing Voice...' : 'Design Custom Voice'}
              </Button>
            </div>
            {!assetOps.customVoiceSupport.supported ? (
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                {assetOps.customVoiceSupport.reason}
              </p>
            ) : assetOps.designCustomVoiceMutation.data ? (
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                Latest designed voice asset: {formatDesignedVoiceLabel(assetOps.designCustomVoiceMutation.data)}.
              </p>
            ) : null}
          </Surface>
        </ForgeSection>
      ) : null}

      {normalizedFamily === 'agent-voice-demo' ? (
        <ForgeSection className="space-y-4">
          <ForgeSectionHeading
            eyebrow="Designed Voices"
            title={`Designed Voice Assets (${designedVoiceAssets.length})`}
            description="Designed voice assets remain reusable on this family surface and do not fall back to plain TTS when the independent binding is missing."
          />
          {!assetOps.customVoiceSupport.supported ? (
            <ForgeEmptyState message={assetOps.customVoiceSupport.reason || 'Custom voice design is unavailable.'} />
          ) : assetOps.designedVoiceAssetsQuery.isLoading ? (
            <ForgeLoadingSpinner />
          ) : designedVoiceAssets.length === 0 ? (
            <ForgeEmptyState message="No designed voice assets are available yet for the current voice-design binding." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {designedVoiceAssets.map((asset) => (
                <DesignedVoiceAssetCard
                  key={asset.voiceAssetId}
                  asset={asset}
                  selected={asset.voiceAssetId === selectedVoiceAssetId}
                  onSelect={() => setSelectedVoiceAssetId(asset.voiceAssetId)}
                />
              ))}
            </div>
          )}
        </ForgeSection>
      ) : null}

      {normalizedFamily === 'agent-greeting-primary' ? (
        <ForgeSection className="space-y-4">
          <ForgeSectionHeading
            eyebrow="Intake"
            title="Add Greeting Candidate"
            description="Manual text entry joins the same lifecycle flow as generated greeting candidates."
          />
          <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
            <LabeledTextareaField
              label="Greeting Candidate"
              value={manualGreeting}
              onChange={setManualGreeting}
              rows={5}
              placeholder="Write a candidate greeting line..."
            />
            <div className="flex flex-wrap gap-2">
              <Button
                tone="primary"
                size="sm"
                onClick={() => {
                  assetOps.addTextCandidate({
                    family: 'agent-greeting-primary',
                    text: queuedGreetingText,
                    origin: 'manual',
                    lifecycle: 'candidate',
                  });
                  setManualGreeting('');
                }}
                disabled={!queuedGreetingText}
              >
                Queue Candidate
              </Button>
              <Button
                tone="secondary"
                size="sm"
                onClick={() =>
                  void assetOps.generateGreetingCandidateMutation.mutateAsync({
                    worldName: worldQuery.data?.name,
                    worldDescription: worldQuery.data?.description ?? undefined,
                  })
                }
                disabled={assetOps.generateGreetingCandidateMutation.isPending}
              >
                {assetOps.generateGreetingCandidateMutation.isPending ? 'Generating...' : 'Generate With Copy Flow'}
              </Button>
            </div>
          </Surface>
        </ForgeSection>
      ) : null}

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Review"
          title={`Candidate Review Queue (${familyState.candidateList.length})`}
          description="Use explicit lifecycle actions here instead of direct bind helpers or hidden detail-page ownership."
        />
        {familyState.candidateList.length === 0 ? (
          <ForgeEmptyState message="No candidates are queued yet. Generate one, synthesize one, or add one from the library below." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {familyState.candidateList.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                family={normalizedFamily}
                agentName={agent.displayName || agent.handle}
                highlighted={candidate.resourceId === highlightedResourceId}
                onAdoptCurrent={() => assetOps.adoptCurrentFieldCandidate(normalizedFamily === 'agent-avatar' ? 'agent-avatar' : 'agent-greeting-primary')}
                onReview={() => assetOps.reviewGeneratedCandidate(candidate.id)}
                onApprove={() => assetOps.approveCandidate(candidate.id)}
                onReject={() => assetOps.rejectCandidate(candidate.id)}
                onConfirm={() => assetOps.confirmCandidate(candidate.id)}
                onBind={() => void assetOps.bindConfirmed({ family: normalizedFamily, candidateId: candidate.id })}
                bindingBusy={assetOps.bindConfirmedMutation.isPending}
                bindSupported={familyState.bindSupport.supported}
              />
            ))}
          </div>
        )}
      </ForgeSection>

      {normalizedFamily !== 'agent-greeting-primary' ? (
        <ForgeSection className="space-y-4">
          <ForgeSectionHeading
            eyebrow="Library"
            title={normalizedFamily === 'agent-voice-demo'
              ? `Add From Library (${libraryAudio.length})`
              : `Add From Library (${libraryImages.length})`}
            description={normalizedFamily === 'agent-voice-demo'
              ? 'Audio resources are not family truth until you explicitly queue them into this review flow.'
              : 'Saved image resources are not family truth until you explicitly queue them into this review flow.'}
          />
          {(normalizedFamily === 'agent-voice-demo' ? libraryAudio.length === 0 : libraryImages.length === 0) ? (
            <ForgeEmptyState message={normalizedFamily === 'agent-voice-demo'
              ? 'No additional audio resources are available to queue into this family.'
              : 'No additional image resources are available to queue into this family.'}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(normalizedFamily === 'agent-voice-demo' ? libraryAudio : libraryImages).slice(0, 12).map((resource) => (
                <LibraryCard
                  key={resource.id}
                  family={normalizedFamily}
                  resource={resource}
                  onQueue={() => {
                    assetOps.addResourceCandidate({
                      family: normalizedFamily,
                      resourceId: resource.id,
                      previewUrl: resource.url,
                      mimeType: inferMimeType(resource),
                      origin: 'library',
                    });
                  }}
                />
              ))}
            </div>
          )}
        </ForgeSection>
      ) : null}
    </ForgePage>
  );
}

function CandidateCard({
  candidate,
  family,
  agentName,
  highlighted,
  onAdoptCurrent,
  onReview,
  onApprove,
  onReject,
  onConfirm,
  onBind,
  bindingBusy,
  bindSupported,
}: {
  candidate: AgentAssetOpsCandidateView;
  family: AgentAssetOpsFamily;
  agentName: string;
  highlighted: boolean;
  onAdoptCurrent: () => void;
  onReview: () => void;
  onApprove: () => void;
  onReject: () => void;
  onConfirm: () => void;
  onBind: () => void;
  bindingBusy: boolean;
  bindSupported: boolean;
}) {
  return (
    <Surface
      tone="card"
      material={highlighted ? 'glass-regular' : 'glass-thin'}
      elevation={highlighted ? 'raised' : 'base'}
      padding="md"
      className="space-y-4"
    >
      {candidate.previewUrl ? (
        family === 'agent-voice-demo' ? (
          <audio controls className="w-full">
            <source src={candidate.previewUrl} />
          </audio>
        ) : (
          <img
            src={candidate.previewUrl}
            alt=""
            className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'agent-cover' ? 'aspect-[9/16]' : 'aspect-square'}`}
          />
        )
      ) : candidate.text ? (
        <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="min-h-36">
          <p className="text-sm leading-6 text-[var(--nimi-text-primary)]">{candidate.text}</p>
        </Surface>
      ) : (
        <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${family === 'agent-cover' ? 'aspect-[9/16]' : 'aspect-square'}`}>
          <ForgeEntityAvatar name={agentName} size="lg" />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {candidate.resourceId
                ? `Resource ${candidate.resourceId.slice(0, 8)}`
                : candidate.text
                  ? candidate.text.slice(0, 36)
                  : candidate.id}
            </p>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              Updated {formatDate(candidate.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {highlighted ? (
              <ForgeStatusBadge domain="generic" status="PRESENT" label="Library Handoff" tone="info" />
            ) : null}
            <ForgeStatusBadge
              domain="generic"
              status={candidate.effectiveLifecycle.toUpperCase()}
              label={candidate.effectiveLifecycle}
              tone={LIFECYCLE_TONE[candidate.effectiveLifecycle]}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {candidate.isSynthetic && (family === 'agent-avatar' || family === 'agent-greeting-primary') ? (
            <>
              <Button tone="primary" size="sm" onClick={onAdoptCurrent}>
                Adopt Current
              </Button>
              <Button tone="ghost" size="sm" disabled>
                Current Truth
              </Button>
            </>
          ) : null}

          {!candidate.isSynthetic || (family !== 'agent-avatar' && family !== 'agent-greeting-primary') ? (
            <>
          {candidate.effectiveLifecycle === 'generated' || candidate.effectiveLifecycle === 'rejected' || candidate.effectiveLifecycle === 'superseded' ? (
            <Button tone="ghost" size="sm" onClick={onReview}>
              Return to Review
            </Button>
          ) : (
            <Button tone="ghost" size="sm" disabled>
              Review Ready
            </Button>
          )}

          {candidate.effectiveLifecycle === 'candidate' ? (
            <Button tone="secondary" size="sm" onClick={onApprove}>
              Approve
            </Button>
          ) : (
            <Button tone="secondary" size="sm" disabled>
              Approve
            </Button>
          )}

          {candidate.effectiveLifecycle === 'candidate' || candidate.effectiveLifecycle === 'approved' ? (
            <Button tone="ghost" size="sm" onClick={onReject}>
              Reject
            </Button>
          ) : (
            <Button tone="ghost" size="sm" disabled>
              Reject
            </Button>
          )}

          {candidate.effectiveLifecycle === 'approved' ? (
            <Button tone="secondary" size="sm" onClick={onConfirm}>
              Confirm
            </Button>
          ) : candidate.effectiveLifecycle === 'confirmed' ? (
            <Button tone="primary" size="sm" onClick={onBind} disabled={bindingBusy || !bindSupported}>
              {bindingBusy ? 'Binding...' : 'Bind'}
            </Button>
          ) : candidate.effectiveLifecycle === 'bound' ? (
            <Button tone="primary" size="sm" disabled>
              Bound
            </Button>
          ) : (
            <Button tone="secondary" size="sm" disabled>
              Confirm
            </Button>
          )}
            </>
          ) : null}
        </div>

        <p className="text-xs text-[var(--nimi-text-muted)]">
          {candidate.isSynthetic
            ? 'This row was synthesized from current truth because the active winner was not yet present in local candidate state.'
            : `Origin: ${candidate.origin}. Candidate id ${candidate.id}.`}
        </p>
      </div>
    </Surface>
  );
}

function LibraryCard({
  family,
  resource,
  onQueue,
}: {
  family: Exclude<AgentAssetOpsFamily, 'agent-greeting-primary'>;
  resource: ResourceSummary;
  onQueue: () => void;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-4">
      {resource.url ? (
        family === 'agent-voice-demo' ? (
          <audio controls className="w-full">
            <source src={resource.url} />
          </audio>
        ) : (
          <img
            src={resource.url}
            alt={resource.title || resource.label || resource.id}
            className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'agent-cover' ? 'aspect-[9/16]' : 'aspect-square'}`}
          />
        )
      ) : null}
      <div>
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {resource.title || resource.label || `Resource ${resource.id.slice(0, 8)}`}
        </p>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          Updated {formatDate(resource.updatedAt)}
        </p>
      </div>
      <Button tone="secondary" size="sm" onClick={onQueue}>
        Queue Candidate
      </Button>
    </Surface>
  );
}

function DesignedVoiceAssetCard({
  asset,
  selected,
  onSelect,
}: {
  asset: DesignedVoiceAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Surface
      tone="card"
      material={selected ? 'glass-regular' : 'glass-thin'}
      elevation={selected ? 'raised' : 'base'}
      padding="md"
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {formatDesignedVoiceLabel(asset)}
          </p>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            Target model {asset.targetModelId || asset.modelId || 'unknown'}
          </p>
        </div>
        <ForgeStatusBadge
          domain="generic"
          status={asset.status === 'ACTIVE' ? 'BOUND' : 'MISSING'}
          label={asset.status}
          tone={asset.status === 'ACTIVE' ? 'success' : 'warning'}
        />
      </div>
      <div className="space-y-1 text-xs text-[var(--nimi-text-muted)]">
        <p>Voice asset {asset.voiceAssetId.slice(0, 8)}</p>
        {asset.providerVoiceRef ? <p>Provider ref {asset.providerVoiceRef}</p> : null}
        <p>Updated {asset.updatedAt ? formatDate(asset.updatedAt) : 'Unknown'}</p>
      </div>
      <Button tone={selected ? 'primary' : 'secondary'} size="sm" onClick={onSelect}>
        {selected ? 'Selected for Synthesis' : 'Use for Synthesis'}
      </Button>
    </Surface>
  );
}

function LifecycleCounter({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{value}</p>
    </Surface>
  );
}

function formatDesignedVoiceLabel(asset: DesignedVoiceAsset): string {
  return asset.providerVoiceRef
    ? `${asset.providerVoiceRef} · ${asset.voiceAssetId.slice(0, 8)}`
    : `Voice Asset ${asset.voiceAssetId.slice(0, 8)}`;
}

function isAgentAssetFamily(value: string): value is AgentAssetOpsFamily {
  return (
    value === 'agent-avatar'
    || value === 'agent-cover'
    || value === 'agent-greeting-primary'
    || value === 'agent-voice-demo'
  );
}

function buildStudioPath(input: {
  agentId: string;
  target: 'agent-avatar' | 'agent-portrait';
  agentName: string;
  worldId: string | null;
  worldName: string | null;
}): string {
  const params = new URLSearchParams({
    target: input.target,
    agentId: input.agentId,
    agentName: input.agentName,
  });
  if (input.worldId) {
    params.set('worldId', input.worldId);
  }
  if (input.worldName) {
    params.set('worldName', input.worldName);
  }
  return `/content/images?${params.toString()}`;
}

function inferMimeType(resource: ResourceSummary): string | null {
  if (resource.resourceType === 'IMAGE') {
    return 'image/*';
  }
  if (resource.resourceType === 'AUDIO') {
    return 'audio/*';
  }
  return null;
}
