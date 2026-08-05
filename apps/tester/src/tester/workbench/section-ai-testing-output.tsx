import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { Copy as CopyIcon, Download as DownloadIcon, Maximize2, X } from 'lucide-react';
import { useTesterRendererHost } from '../../renderer/context.js';
import type { TesterRendererCommandPort } from '../../renderer/contract.js';
import type { TesterCapabilityRunResult } from '../tester-runtime.js';
import { unavailableReasonTitle } from '../tester-unavailable.js';

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
    return output.text || '(empty body)';
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
      firstArtifact: output.firstArtifact,
    }, null, 2);
  }
  if (output.kind === 'transcript') {
    return output.text || '(empty transcript)';
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
  const canExport = text.trim().length > 0;
  function handleCopyDiagnostics() {
    if (!canExport) return;
    try {
      void rendererHost.app.commands.copyText(text);
    } catch {
      // Clipboard remains best-effort; download is the durable path.
    }
  }
  function handleDownloadDiagnostics() {
    if (!canExport) return;
    const stamp = new Date(rendererHost.clock.now()).toISOString().replace(/[:.]/g, '-');
    void downloadTextFile(rendererHost.app.commands, `${filenameBase}-runtime-details-${stamp}.txt`, text);
  }
  return (
    <div className="studio-diag__actions">
      <Tooltip content="Copy Runtime details" placement="top">
        <IconButton type="button" className="studio-result__action" onClick={handleCopyDiagnostics} disabled={!canExport} aria-label="Copy Runtime details" icon={<CopyIcon size={15} aria-hidden="true" />} />
      </Tooltip>
      <Tooltip content="Download Runtime details" placement="top">
        <IconButton type="button" className="studio-result__action" onClick={handleDownloadDiagnostics} disabled={!canExport} aria-label="Download Runtime details" icon={<DownloadIcon size={15} aria-hidden="true" />} />
      </Tooltip>
    </div>
  );
}

export type StudioArtifactPreviewSource = {
  artifactId?: string;
  mimeType?: string;
  url?: string;
  displayName?: string;
};

export function hasPreviewableArtifact(artifact?: StudioArtifactPreviewSource): boolean {
  const mimeType = artifact?.mimeType ?? '';
  return Boolean(
    artifact?.url
      && (mimeType.startsWith('image/') || mimeType.startsWith('audio/') || mimeType.startsWith('video/')),
  );
}

// Rich media preview for runtime artifact results (image / audio / video).
// It only renders from a typed artifact URL/MIME pair; no placeholder media is
// fabricated when Runtime returns metadata without previewable bytes.
export function ArtifactMediaPreview({
  artifact,
  fallbackLabel,
}: {
  artifact?: StudioArtifactPreviewSource;
  fallbackLabel: string;
}) {
  const url = artifact?.url;
  const mimeType = artifact?.mimeType ?? '';
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  useEffect(() => {
    setImagePreviewOpen(false);
  }, [mimeType, url]);
  if (!hasPreviewableArtifact(artifact) || !url) return null;
  const label = artifact?.displayName || artifact?.artifactId || fallbackLabel;
  const isImage = mimeType.startsWith('image/');
  let media: ReactNode = null;
  if (isImage) {
    media = (
      <div className="ai-result__media-frame">
        <img src={url} alt={label} loading="lazy" />
        <Tooltip content="Expand image" placement="top">
          <IconButton
            type="button"
            className="ai-result__media-expand nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
            data-nimi-material="glass-thin"
            data-nimi-tone="overlay"
            aria-label="Expand generated image"
            onClick={() => setImagePreviewOpen(true)}
            icon={<Maximize2 size={16} aria-hidden="true" />}
          />
        </Tooltip>
      </div>
    );
  } else if (mimeType.startsWith('audio/')) {
    media = <audio controls src={url} />;
  } else if (mimeType.startsWith('video/')) {
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
            <DialogTitle className="ai-result-preview-modal__title">Image preview</DialogTitle>
            <IconButton
              type="button"
              className="ai-result-preview-modal__close"
              aria-label="Close image preview"
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
  const value = text || '(empty body)';
  const subject = splitSubjectLine(value);
  if (!subject) {
    return <div className="studio-result__text">{value}</div>;
  }
  return (
    <div className="studio-result__text studio-result__text--formatted">
      <h2 className="studio-result__subject">{subject.subject}</h2>
      <div className="studio-result__divider" aria-hidden="true" />
      <div className="studio-result__text-body">{subject.body || '(empty body)'}</div>
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
