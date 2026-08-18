import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, nimiToast, Tooltip } from '@nimiplatform/kit/ui';
import { Copy as CopyIcon, Download as DownloadIcon, Maximize2, X } from 'lucide-react';
import { t as i18nT, useTranslation } from '../../shell/i18n/index.js';
import { useTesterRendererHost } from '../../renderer/context.js';
import { openNimiLocalAppAssetMediaUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import type { TesterRendererCommandPort } from '../../renderer/contract.js';
import type { TesterCapabilityRunResult } from '../tester-runtime.js';
import { unavailableReasonTitle } from '../tester-unavailable.js';
import {
  STUDIO_ARTIFACT_IMAGE_LOADING,
  hasStudioArtifactMedia,
  studioArtifactRenderBranch,
  type StudioArtifactPreviewSource,
} from './section-ai-testing-artifact-preview.js';

export function formatTypedOutput(result: TesterCapabilityRunResult & { ok: true }): string {
  const output = result.output;
  if (result.capabilityId === 'world.generate') {
    return JSON.stringify({
      viewerStatus: 'viewer opened',
      fixture: 'tauri-only viewer fixture',
      runtimeResult: false,
      runtimeArtifact: false,
      windowLabel: output.kind === 'artifacts' ? output.jobId : undefined,
    }, null, 2);
  }
  if (output.kind === 'text') {
    return output.text || i18nT('StudioShell.emptyBody');
  }
  if (output.kind === 'embedding') {
    return JSON.stringify({
      vectors: output.vectorCount,
      dimensions: output.dimensions,
      sample: output.sample,
      totalTokens: output.totalTokens,
    }, null, 2);
  }
  if (output.kind === 'artifacts') {
    return JSON.stringify({
      jobId: output.jobId,
      jobState: output.jobState,
      artifactCount: output.artifactCount,
      artifacts: output.artifacts,
      firstArtifact: output.firstArtifact,
    }, null, 2);
  }
  if (output.kind === 'transcript') {
    return output.text || i18nT('StudioShell.emptyTranscript');
  }
  if (output.kind === 'voice-asset') {
    return JSON.stringify({
      jobId: output.jobId,
      jobState: output.jobState,
      voiceAssetId: output.voiceAssetId,
      creationSource: output.creationSource,
      assetStatus: output.assetStatus,
      voiceReference: output.voiceReference,
    }, null, 2);
  }
  return JSON.stringify({
    voiceCount: output.voiceCount,
    sample: output.sample,
  }, null, 2);
}

export function formatUnavailableOutput(result: TesterCapabilityRunResult & { ok: false }): string {
  return [
    unavailableReasonTitle(result.reason),
    '',
    `Capability: ${result.capabilityId}`,
    `Reason: ${result.reason}`,
    result.missingSurface ? `Missing surface: ${result.missingSurface}` : '',
    '',
    'Message:',
    result.message,
    '',
    'Action:',
    result.actionHint,
    result.diagnostics ? 'Technical diagnostics:' : '',
    result.diagnostics?.reasonCode ? `Reason code: ${result.diagnostics.reasonCode}` : '',
    result.diagnostics?.actionHint ? `Owner action: ${result.diagnostics.actionHint}` : '',
    result.diagnostics?.traceId ? `Trace: ${result.diagnostics.traceId}` : '',
    result.diagnostics?.retryable !== undefined ? `Retryable: ${String(result.diagnostics.retryable)}` : '',
    result.diagnostics?.source ? `Source: ${result.diagnostics.source}` : '',
  ].filter(Boolean).join('\n');
}

// Plain-text projection used for Copy / Download. Text and transcript export the
// raw body; structured successes export their typed JSON summary; unavailable
// results export the fail-closed Runtime diagnostic without converting it into a
// success state.
export function resultPlainText(result: TesterCapabilityRunResult): string {
  if (!result.ok) return formatUnavailableOutput(result);
  if (result.output.kind === 'text') return result.output.text;
  if (result.output.kind === 'transcript') return result.output.text;
  return formatTypedOutput(result);
}

export function RuntimeDiagnosticsActions({
  text,
  filenameBase,
}: {
  text: string;
  filenameBase: string;
}) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const canExport = text.trim().length > 0;
  function handleCopyDiagnostics() {
    if (!canExport) return;
    void rendererHost.app.commands.copyText(text)
      .then((result) => {
        if (result.ok) {
          nimiToast.success(t('Common.copied'));
        } else {
          nimiToast.danger(t('Common.copyFailed'));
        }
      })
      .catch(() => {
        nimiToast.danger(t('Common.copyFailed'));
      });
  }
  function handleDownloadDiagnostics() {
    if (!canExport) return;
    const stamp = new Date(rendererHost.clock.now()).toISOString().replace(/[:.]/g, '-');
    void downloadTextFile(rendererHost.app.commands, `${filenameBase}-runtime-details-${stamp}.txt`, text);
  }
  return (
    <div className="studio-diag__actions">
      <Tooltip content={t('StudioShell.copyRuntimeDetails')} placement="top">
        <IconButton type="button" className="studio-result__action" onClick={handleCopyDiagnostics} disabled={!canExport} aria-label={t('StudioShell.copyRuntimeDetails')} icon={<CopyIcon size={15} aria-hidden="true" />} />
      </Tooltip>
      <Tooltip content={t('StudioShell.downloadRuntimeDetails')} placement="top">
        <IconButton type="button" className="studio-result__action" onClick={handleDownloadDiagnostics} disabled={!canExport} aria-label={t('StudioShell.downloadRuntimeDetails')} icon={<DownloadIcon size={15} aria-hidden="true" />} />
      </Tooltip>
    </div>
  );
}

export type { StudioArtifactPreviewSource } from './section-ai-testing-artifact-preview.js';

export function hasPreviewableArtifact(artifact?: StudioArtifactPreviewSource): boolean {
  return hasStudioArtifactMedia(artifact);
}

// Rich media preview for managed Runtime assets. The only URL exposed to the
// renderer is Kit's short-lived opaque handle; cleanup revokes it.
export function ArtifactMediaPreview({
  artifact,
  fallbackLabel,
}: {
  artifact?: StudioArtifactPreviewSource;
  fallbackLabel: string;
}) {
  const relativePath = artifact?.relativePath;
  const mimeType = artifact?.mediaType ?? '';
  const branch = studioArtifactRenderBranch(artifact);
  const { t } = useTranslation();
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setImagePreviewOpen(false);
    setUrl(null);
    if (!relativePath || !hasPreviewableArtifact(artifact)) return undefined;
    let active = true;
    let revoke: (() => Promise<void>) | null = null;
    void openNimiLocalAppAssetMediaUrl(relativePath)
      .then((handle) => {
        revoke = handle.revoke;
        if (active) setUrl(handle.url);
        else void handle.revoke();
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
      setUrl(null);
      if (revoke) void revoke();
    };
  }, [artifact, mimeType, relativePath]);
  if (!hasPreviewableArtifact(artifact) || !url) return null;
  const label = artifact?.displayName || relativePath || fallbackLabel;
  const isImage = branch === 'image';
  let media: ReactNode = null;
  if (isImage) {
    media = (
      <div className="ai-result__media-frame">
        <img src={url} alt={label} loading={STUDIO_ARTIFACT_IMAGE_LOADING} />
        <Tooltip content={t('StudioShell.expandImage')} placement="top">
          <IconButton
            type="button"
            className="ai-result__media-expand nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
            data-nimi-material="glass-thin"
            data-nimi-tone="overlay"
            aria-label={t('StudioShell.expandGeneratedImage')}
            onClick={() => setImagePreviewOpen(true)}
            icon={<Maximize2 size={16} aria-hidden="true" />}
          />
        </Tooltip>
      </div>
    );
  } else if (branch === 'audio') {
    media = <audio controls src={url} />;
  } else if (branch === 'video') {
    media = <video controls src={url} />;
  }
  if (!media) return null;
  return (
    <>
      <figure className="ai-result__media" data-mime={mimeType}>
        {media}
      </figure>
      {isImage ? (
        <Dialog open={imagePreviewOpen} onOpenChange={(open) => { if (!open) setImagePreviewOpen(false); }}>
          <DialogContent
            onClose={() => setImagePreviewOpen(false)}
            overlayClassName="ai-result-preview-modal__overlay"
            className="ai-result-preview-modal"
          >
            <DialogTitle className="ai-result-preview-modal__title">{t('StudioShell.imagePreview')}</DialogTitle>
            <IconButton
              type="button"
              className="ai-result-preview-modal__close"
              aria-label={t('StudioShell.closeImagePreview')}
              onClick={() => setImagePreviewOpen(false)}
              icon={<X size={20} aria-hidden="true" />}
            />
            <img src={url} alt={label} className="ai-result-preview-modal__image" />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function ArtifactMediaResult({
  artifact,
  fallbackLabel,
}: {
  artifact?: StudioArtifactPreviewSource;
  fallbackLabel: string;
}) {
  const { t } = useTranslation();
  const branch = studioArtifactRenderBranch(artifact);
  if (branch === 'image' || branch === 'audio' || branch === 'video') {
    return <ArtifactMediaPreview artifact={artifact} fallbackLabel={fallbackLabel} />;
  }
  return (
    <div className="studio-result__media-unavailable">
      <p className="studio-result__plain">
        {branch === 'unsupported'
          ? t('StudioShell.mediaPreviewUnsupported')
          : t('StudioShell.mediaPreviewMetadataOnly')}
      </p>
      <p className="studio-result__hint">{t('StudioShell.mediaMetadataDownloadHint')}</p>
    </div>
  );
}

function splitSubjectLine(text: string): { subject: string; body: string } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const [firstLine = '', ...rest] = lines;
  const match = firstLine.match(/^Subject:\s*(.+)$/i);
  if (!match) return null;
  return {
    subject: match[1].trim(),
    body: rest.join('\n').replace(/^\n+/, '').trimEnd(),
  };
}

export function TextStudioOutputBody({ text }: { text: string }) {
  const { t } = useTranslation();
  const emptyBody = t('StudioShell.emptyBody');
  const value = text || emptyBody;
  const subject = splitSubjectLine(value);
  if (!subject) {
    return <div className="studio-result__text">{value}</div>;
  }
  return (
    <div className="studio-result__text studio-result__text--formatted">
      <h2 className="studio-result__subject">{subject.subject}</h2>
      <div className="studio-result__divider" aria-hidden="true" />
      <div className="studio-result__text-body">{subject.body || emptyBody}</div>
    </div>
  );
}

export async function downloadTextFile(
  commands: TesterRendererCommandPort,
  filename: string,
  body: string,
) {
  await commands.exportText({ filename, body });
}

// File extension for a saved media artifact, derived from its MIME subtype.
export function artifactExtension(mimeType?: string): string {
  const subtype = (mimeType || '').split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'quicktime') return 'mov';
  return subtype;
}

// Save a runtime media artifact (image / audio / video) to disk. Works for both
// inline data URLs and hosted URLs by streaming the resource through a Blob.
export async function downloadArtifactUrl(
  commands: TesterRendererCommandPort,
  filename: string,
  url: string,
) {
  await commands.exportArtifact({ filename, url });
}
