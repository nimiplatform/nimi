import React, { useEffect, useCallback } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import { OverlayShell, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { OtButton, OtInput, OtTextarea, OtTagInput } from './ui-primitives.js';
import { Waveform } from './waveform.js';

async function publishTake(input: {
  audioBuffer: ArrayBuffer;
  title: string;
  description: string;
  tags: string[];
  duration: number | undefined;
  onStatus: (status: 'uploading' | 'creating' | 'done' | 'error', error?: string) => void;
  onPostId: (postId: string) => void;
}): Promise<void> {
  let client;
  try {
    client = getPlatformClient();
  } catch {
    input.onStatus('error', 'Realm client is not initialized.');
    return;
  }

  try {
    input.onStatus('uploading');

    const upload = await client.domains.media.createAudioDirectUpload({ mimeType: 'audio/mpeg' });

    const audioBlob = new Blob([input.audioBuffer], { type: 'audio/mpeg' });
    const uploadResponse = await fetch(upload.uploadUrl, {
      method: 'PUT',
      body: audioBlob,
      headers: { 'Content-Type': 'audio/mpeg' },
    });

    if (!uploadResponse.ok) {
      input.onStatus('error', `Audio upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      return;
    }

    input.onStatus('creating');

    const postInput = {
      caption: input.description || input.title,
      media: [
        {
          type: 'AUDIO' as const,
          assetId: upload.assetId,
          duration: input.duration,
        },
      ],
      tags: input.tags.length > 0 ? input.tags : undefined,
    } as unknown as Parameters<typeof client.domains.media.createPost>[0];

    const post = (await client.domains.media.createPost(postInput)) as { id: string };

    input.onPostId(post.id);
    input.onStatus('done');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.onStatus('error', message);
  }
}

/* ─── Mini Preview Waveform ─── */

function PreviewWaveform({ buffer }: { buffer: ArrayBuffer }) {
  const [decoded, setDecoded] = React.useState<AudioBuffer | null>(null);

  useEffect(() => {
    const ctx = new AudioContext();
    ctx.decodeAudioData(buffer.slice(0))
      .then((d) => setDecoded(d))
      .catch(() => setDecoded(null));
    return () => { void ctx.close(); };
  }, [buffer]);

  if (!decoded) return null;

  return (
    <Waveform
      buffer={decoded}
      currentTime={0}
      duration={decoded.duration}
      trimStart={null}
      trimEnd={null}
      onSeek={() => {}}
      mini
    />
  );
}

/* ─── PublishModal ─── */

export function PublishModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const takes = useAppStore((state) => state.takes);
  const selectedTakeId = useAppStore((state) => state.selectedTakeId);
  const brief = useAppStore((state) => state.brief);
  const audioBuffers = useAppStore((state) => state.audioBuffers);
  const realmConfigured = useAppStore((state) => state.realmConfigured);
  const realmAuthenticated = useAppStore((state) => state.realmAuthenticated);

  const draftPost = useAppStore((state) => state.draftPost);
  const provenanceConfirmed = useAppStore((state) => state.provenanceConfirmed);
  const publishStatus = useAppStore((state) => state.publishStatus);
  const publishError = useAppStore((state) => state.publishError);
  const publishedPostId = useAppStore((state) => state.publishedPostId);

  const setDraftPost = useAppStore((state) => state.setDraftPost);
  const setProvenanceConfirmed = useAppStore((state) => state.setProvenanceConfirmed);
  const setPublishStatus = useAppStore((state) => state.setPublishStatus);
  const setPublishedPostId = useAppStore((state) => state.setPublishedPostId);

  const selectedTake = takes.find((take) => take.takeId === selectedTakeId);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const effectiveTitle = draftPost?.title || brief?.title || selectedTake?.title || '';
  const effectiveDescription = draftPost?.description || brief?.description || '';
  const effectiveTags = draftPost?.tags ?? [];

  const audioBuffer = selectedTakeId ? audioBuffers.get(selectedTakeId) : undefined;

  const hasBlocker = !realmConfigured || !realmAuthenticated;

  const canPublish =
    !hasBlocker &&
    provenanceConfirmed &&
    audioBuffer != null &&
    publishStatus !== 'uploading' &&
    publishStatus !== 'creating' &&
    publishStatus !== 'done';

  const isPublishing = publishStatus === 'uploading' || publishStatus === 'creating';

  const sourceLabel = selectedTake
    ? selectedTake.origin === 'prompt'
      ? 'AI-generated from a text prompt'
      : selectedTake.origin === 'reference'
        ? 'AI-generated with uploaded reference audio'
        : `AI-generated by ${selectedTake.origin} from an existing take`
    : '';

  const handlePublish = useCallback(() => {
    if (!canPublish || !audioBuffer) return;

    publishTake({
      audioBuffer,
      title: effectiveTitle,
      description: effectiveDescription,
      tags: effectiveTags,
      duration: undefined,
      onStatus: (status, error) => setPublishStatus(status, error),
      onPostId: (postId) => setPublishedPostId(postId),
    });
  }, [canPublish, audioBuffer, effectiveTitle, effectiveDescription, effectiveTags, setPublishStatus, setPublishedPostId]);

  if (!open || !selectedTake) return null;

  return (
    <OverlayShell
      open={open}
      onClose={onClose}
      kind="dialog"
      panelClassName="ot-publish-modal max-w-[520px] bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
      contentClassName="space-y-4 px-6 py-4"
      title={<h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Publish to Realm</h2>}
      footer={(
        <div className="flex items-center justify-between">
          <OtButton variant="tertiary" onClick={onClose} type="button">
            Cancel
          </OtButton>
          <OtButton
            variant="primary"
            onClick={handlePublish}
            disabled={!canPublish}
            loading={isPublishing}
            type="button"
          >
            {isPublishing
              ? publishStatus === 'uploading' ? 'Uploading...' : 'Creating post...'
              : publishStatus === 'done'
                ? 'Published'
                : 'Publish Now'}
          </OtButton>
        </div>
      )}
    >
      <Surface tone="panel" padding="none" className="bg-[var(--nimi-surface-panel)] px-3 py-3 shadow-none">
          {audioBuffer && <PreviewWaveform buffer={audioBuffer} />}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--nimi-text-primary)] truncate">{selectedTake.title}</span>
            <StatusBadge tone="info" className={`ot-badge-origin ot-badge-origin--${selectedTake.origin}`}>{selectedTake.origin}</StatusBadge>
          </div>
      </Surface>

      {hasBlocker && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-warning)]">
          {!realmConfigured
            ? 'Realm is not configured. Set VITE_NIMI_REALM_BASE_URL and VITE_NIMI_REALM_ACCESS_TOKEN.'
            : 'Realm is configured but authentication is not available.'}
        </div>
      )}

      {publishStatus === 'error' && publishError && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
          {publishError}
          <button
            className="ml-2 underline"
            onClick={() => setPublishStatus('idle')}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {publishStatus === 'done' && publishedPostId && (
        <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-success)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-success)]">
          <span>✨</span>
          Published! Post ID: <span className="font-mono">{publishedPostId}</span>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-[0.06em] text-[var(--nimi-text-muted)]">Title</label>
        <OtInput
          value={effectiveTitle}
          onChange={(event) =>
            setDraftPost({
              title: event.target.value,
              description: effectiveDescription,
              tags: effectiveTags,
            })
          }
          placeholder="Song title"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-[0.06em] text-[var(--nimi-text-muted)]">Description</label>
        <OtTextarea
          value={effectiveDescription}
          onChange={(event) =>
            setDraftPost({
              title: effectiveTitle,
              description: event.target.value,
              tags: effectiveTags,
            })
          }
          placeholder="Describe your song..."
        />
      </div>

      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-[0.06em] text-[var(--nimi-text-muted)]">Tags</label>
        <OtTagInput
          tags={effectiveTags}
          onChange={(tags) =>
            setDraftPost({
              title: effectiveTitle,
              description: effectiveDescription,
              tags,
            })
          }
          placeholder="comma separated tags"
        />
      </div>

      <Surface tone="panel" padding="md" className="bg-[var(--nimi-surface-panel)] border-[color-mix(in_srgb,var(--nimi-surface-card)_74%,var(--nimi-action-primary-bg)_26%)] shadow-none">
        <div className="space-y-2">
          <p className="text-xs text-[var(--nimi-text-secondary)]">
            Source: <span className="text-[var(--nimi-text-primary)]">{sourceLabel}</span>
          </p>
          {selectedTake.parentTakeId && (
            <p className="text-[10px] text-[color-mix(in_srgb,var(--nimi-text-muted)_74%,transparent)]">
              Parent: {takes.find((t) => t.takeId === selectedTake.parentTakeId)?.title ?? selectedTake.parentTakeId}
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={provenanceConfirmed}
              onChange={(event) => setProvenanceConfirmed(event.target.checked)}
              className="mt-0.5 accent-[var(--nimi-action-primary-bg)]"
            />
            <span className="text-xs text-[var(--nimi-text-secondary)]">
              I confirm the source material is original or I have the right to publish it.
            </span>
          </label>
        </div>
      </Surface>
    </OverlayShell>
  );
}
