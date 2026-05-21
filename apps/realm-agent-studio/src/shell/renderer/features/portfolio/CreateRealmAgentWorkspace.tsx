import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, FieldShell, InlineAlert, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  CREATE_REALM_AGENT_BLOCKED_REASON,
  normalizeCreateRealmAgentDraft,
  selectOasisDefaultWorld,
  validateCreateRealmAgentReadiness,
  type CreateRealmAgentDraftInput,
  type SelectableRealmWorld,
} from './create-agent-draft.js';
import {
  getCreateRealmAgentWorldPreview,
  listCreateRealmAgentSelectableWorlds,
} from './portfolio-client.js';

function createEmptyDraft(): CreateRealmAgentDraftInput {
  return {
    handle: '',
    displayName: '',
    publicBio: '',
    concept: '',
    description: '',
    ruleText: '',
    selectedWorldId: '',
  };
}

function worldOptionLabel(world: SelectableRealmWorld): string {
  const type = world.type ? ` · ${world.type}` : '';
  return `${world.name}${type}`;
}

function ReadinessPreview({ draft }: { draft: CreateRealmAgentDraftInput }) {
  const normalizedDraft = normalizeCreateRealmAgentDraft(draft);
  const readiness = validateCreateRealmAgentReadiness(draft);

  return (
    <div className="grid gap-4">
      <Surface tone="card" padding="md">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium">Visible public fields before submit</div>
          <StatusBadge tone="info">local draft</StatusBadge>
        </div>
        <dl className="mt-3 grid gap-2 text-[length:var(--nimi-type-body-sm-size)]">
          <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
            <dt className="text-[var(--nimi-text-muted)]">Handle</dt>
            <dd className="ras-break-anywhere m-0">@{normalizedDraft.handle || 'not set'}</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
            <dt className="text-[var(--nimi-text-muted)]">Display name</dt>
            <dd className="ras-break-anywhere m-0">{normalizedDraft.displayName || 'not set'}</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
            <dt className="text-[var(--nimi-text-muted)]">Public bio</dt>
            <dd className="ras-break-anywhere m-0">{normalizedDraft.publicBio || 'not set'}</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
            <dt className="text-[var(--nimi-text-muted)]">World ID</dt>
            <dd className="ras-break-anywhere m-0">{normalizedDraft.selectedWorldId || 'not set'}</dd>
          </div>
        </dl>
      </Surface>

      {readiness.ready ? null : (
        <InlineAlert tone="warning">{readiness.errors.join('; ')}</InlineAlert>
      )}
      <InlineAlert tone="danger">{CREATE_REALM_AGENT_BLOCKED_REASON}</InlineAlert>
      <FieldShell label="Candidate create payload" message="Preview only. This workspace does not call CreatorService.creatorControllerCreateAgent.">
        <pre className="ras-json-preview m-0 min-h-56 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
          {readiness.payload ? JSON.stringify(readiness.payload, null, 2) : 'Complete handle, display name, and selected world to preview the blocked candidate payload.'}
        </pre>
      </FieldShell>
    </div>
  );
}

export function CreateRealmAgentWorkspace() {
  const [draft, setDraft] = useState<CreateRealmAgentDraftInput>(() => createEmptyDraft());
  const worldsQuery = useQuery({
    queryKey: ['realm-agent-studio', 'create-agent-worlds'],
    queryFn: () => listCreateRealmAgentSelectableWorlds(),
  });

  const worlds = worldsQuery.data || [];
  const oasisWorld = useMemo(() => selectOasisDefaultWorld(worlds), [worlds]);
  const selectedWorld = worlds.find((world) => world.id === draft.selectedWorldId) || null;
  const selectedWorldId = draft.selectedWorldId;

  const worldPreviewQuery = useQuery({
    queryKey: ['realm-agent-studio', 'create-agent-world-preview', selectedWorldId],
    queryFn: () => getCreateRealmAgentWorldPreview(selectedWorldId),
    enabled: selectedWorldId.length > 0,
  });

  useEffect(() => {
    if (!draft.selectedWorldId && oasisWorld) {
      setDraft((current) => current.selectedWorldId ? current : { ...current, selectedWorldId: oasisWorld.id });
    }
  }, [draft.selectedWorldId, oasisWorld]);

  function updateDraft(patch: Partial<CreateRealmAgentDraftInput>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <Surface tone="panel" padding="lg" className="min-w-0">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="m-0 text-xl font-semibold">Create Realm Agent readiness</h2>
            <StatusBadge tone="info">draft only</StatusBadge>
            <StatusBadge tone="warning">create write blocked</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Local public identity and world readiness workspace. Creation success is not claimed until an admitted Studio create write contract exists.
          </p>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FieldShell label="Agent handle" message="Normalized locally for preview; uniqueness is not checked in this slice.">
                <TextField
                  value={draft.handle}
                  placeholder="@creator-agent"
                  onChange={(event) => updateDraft({ handle: event.currentTarget.value })}
                />
              </FieldShell>
              <FieldShell label="Display name" message="Visible public identity field before submit.">
                <TextField
                  value={draft.displayName}
                  placeholder="Creator Agent"
                  onChange={(event) => updateDraft({ displayName: event.currentTarget.value })}
                />
              </FieldShell>
            </div>
            <FieldShell label="Public bio" message="Visible preview field only; no Realm write is performed.">
              <TextareaField
                value={draft.publicBio}
                placeholder="Short public bio"
                onChange={(event) => updateDraft({ publicBio: event.currentTarget.value })}
              />
            </FieldShell>
            <div className="grid gap-4 md:grid-cols-2">
              <FieldShell label="Concept" message="CreateAgentDto concept candidate; local preview only.">
                <TextareaField
                  value={draft.concept}
                  placeholder="Creative concept"
                  onChange={(event) => updateDraft({ concept: event.currentTarget.value })}
                />
              </FieldShell>
              <FieldShell label="Description" message="CreateAgentDto description candidate; local preview only.">
                <TextareaField
                  value={draft.description}
                  placeholder="Public-facing description"
                  onChange={(event) => updateDraft({ description: event.currentTarget.value })}
                />
              </FieldShell>
            </div>
            <FieldShell label="Visible rules" message="Rule-shaped candidate content remains owner-visible before any future write.">
              <TextareaField
                value={draft.ruleText}
                placeholder="Style, boundaries, and public behavior rules"
                onChange={(event) => updateDraft({ ruleText: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell
              label="World"
              message={oasisWorld ? `Defaults to source-backed OASIS world: ${oasisWorld.name}.` : 'OASIS default unavailable until Realm world list returns an OASIS world.'}
              messageTone={oasisWorld ? 'neutral' : 'danger'}
            >
              <SelectField
                disabled={worldsQuery.isLoading || worlds.length === 0}
                value={draft.selectedWorldId}
                options={worlds.map((world) => ({ value: world.id, label: worldOptionLabel(world) }))}
                onValueChange={(value) => updateDraft({ selectedWorldId: value })}
              />
            </FieldShell>
            {worldsQuery.isError ? (
              <InlineAlert tone="danger">World selection source unavailable: WorldsService.worldControllerListWorlds failed.</InlineAlert>
            ) : null}
            {!worldsQuery.isLoading && worlds.length === 0 ? (
              <InlineAlert tone="warning">World selection blocked: Realm returned no selectable worlds from WorldsService.worldControllerListWorlds.</InlineAlert>
            ) : null}
            <Button disabled title={CREATE_REALM_AGENT_BLOCKED_REASON}>Create Realm Agent blocked</Button>
          </div>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Surface tone="card" padding="md">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium">Selected world preview</div>
              <StatusBadge tone="neutral">WorldsService detail</StatusBadge>
            </div>
            {!selectedWorld ? (
              <EmptyState title="No selected world" description="Select a Realm world from the source-backed list." />
            ) : worldPreviewQuery.isLoading ? (
              <EmptyState title="Loading world preview" description="Reading WorldsService.worldControllerGetWorldDetailWithAgents." />
            ) : worldPreviewQuery.isError ? (
              <InlineAlert tone="danger">Selected-world basic setting preview unavailable from WorldsService.worldControllerGetWorldDetailWithAgents.</InlineAlert>
            ) : worldPreviewQuery.data ? (
              <div className="mt-3 grid gap-3 text-[length:var(--nimi-type-body-sm-size)]">
                <div>
                  <div className="ras-break-anywhere font-medium">{worldPreviewQuery.data.name}</div>
                  <div className="ras-break-anywhere mt-1 text-[var(--nimi-text-muted)]">{worldPreviewQuery.data.tagline || worldPreviewQuery.data.description || 'basic setting text unavailable'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="info">{worldPreviewQuery.data.type || 'type unavailable'}</StatusBadge>
                  <StatusBadge tone="neutral">{worldPreviewQuery.data.status || 'status unavailable'}</StatusBadge>
                  <StatusBadge tone="neutral">{worldPreviewQuery.data.contentRating || 'rating unavailable'}</StatusBadge>
                </div>
                <div className="ras-break-anywhere text-[var(--nimi-text-secondary)]">{worldPreviewQuery.data.overview || 'overview unavailable'}</div>
                <div className="flex flex-wrap gap-2">
                  {worldPreviewQuery.data.themes.length > 0
                    ? worldPreviewQuery.data.themes.map((theme) => <StatusBadge key={theme} tone="neutral">{theme}</StatusBadge>)
                    : <StatusBadge tone="warning">themes unavailable</StatusBadge>}
                </div>
              </div>
            ) : null}
          </Surface>
          <ReadinessPreview draft={draft} />
        </div>
      </div>
    </Surface>
  );
}
