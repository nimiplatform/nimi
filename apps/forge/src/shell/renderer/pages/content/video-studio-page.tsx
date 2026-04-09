/**
 * Video Studio Page (FG-CONTENT-002)
 *
 * Video upload with drag-and-drop, progress tracking, and preview.
 */

import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { finalizeResource } from '@renderer/data/content-data-client.js';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState, ForgeErrorBanner } from '@renderer/components/page-layout.js';
import { formatDate } from '@renderer/components/format-utils.js';

type UploadedVideo = {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  resourceId?: string;
  storageRef?: string;
  previewUrl?: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function VideoStudioPage() {
  const { t } = useTranslation();
  const mutations = useContentMutations();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videos, setVideos] = useState<UploadedVideo[]>([]);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;

    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      setUploadError(t('videoStudio.unsupportedFormat', 'Unsupported format. Use MP4, MOV, or WebM.'));
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const result = await mutations.videoUploadMutation.mutateAsync(undefined);
      const record: JsonObject = result && typeof result === 'object' && !Array.isArray(result)
        ? result as JsonObject
        : {};
      const uploadUrl = String(record.uploadUrl || '');
      const resourceId = String(record.resourceId || '');
      const storageRef = String(record.storageRef || '');

      if (!uploadUrl) {
        throw new Error('No upload URL returned from server');
      }

      // Upload file via XHR for real progress events
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            // Retry with PUT if POST fails
            const putXhr = new XMLHttpRequest();
            xhrRef.current = putXhr;
            putXhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                setUploadProgress(Math.round((e.loaded / e.total) * 100));
              }
            });
            putXhr.addEventListener('load', () => {
              xhrRef.current = null;
              if (putXhr.status >= 200 && putXhr.status < 300) resolve();
              else reject(new Error(`Upload failed: ${putXhr.status}`));
            });
            putXhr.addEventListener('error', () => { xhrRef.current = null; reject(new Error('Upload network error')); });
            putXhr.open('PUT', uploadUrl);
            putXhr.setRequestHeader('Content-Type', file.type);
            putXhr.send(file);
          }
        });

        xhr.addEventListener('error', () => { xhrRef.current = null; reject(new Error('Upload network error')); });
        xhr.addEventListener('abort', () => { xhrRef.current = null; reject(new Error('Upload cancelled')); });

        const formData = new FormData();
        formData.append('file', file);
        xhr.open('POST', uploadUrl);
        xhr.send(formData);
      });

      let previewUrl: string | undefined;
      if (resourceId) {
        try {
          const finalized = await finalizeResource(resourceId, {
            mimeType: file.type,
          });
          const finalizedRecord: JsonObject =
            finalized && typeof finalized === 'object' && !Array.isArray(finalized)
              ? finalized as JsonObject
              : {};
          previewUrl = finalizedRecord.url ? String(finalizedRecord.url) : undefined;
        } catch {
          // Finalize fallback is non-critical for optimistic preview
        }
      }

      setVideos((prev) => [
        {
          id: resourceId || String(Date.now()),
          name: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          resourceId: resourceId || undefined,
          storageRef: storageRef || undefined,
          previewUrl,
        },
        ...prev,
      ]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      xhrRef.current = null;
      setUploading(false);
      setUploadProgress(0);
    }
  }, [mutations.videoUploadMutation]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.videoStudio')}
        subtitle={t('videoStudio.subtitle', 'Upload and manage video content')}
      />

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`rounded-[var(--nimi-radius-md)] border-2 border-dashed p-12 text-center transition-colors ${
          dragOver
            ? 'border-[var(--nimi-border-strong)] bg-[var(--nimi-surface-active)]'
            : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-border-strong)]'
        }`}
      >
        {uploading ? (
          <div className="space-y-3">
            <div className="w-8 h-8 border-2 border-[var(--nimi-border-subtle)] border-t-[var(--nimi-text-primary)] rounded-full animate-spin mx-auto" />
            <p className="text-sm text-[var(--nimi-text-primary)]">{t('videoStudio.uploading', { progress: uploadProgress })}</p>
            <div className="w-64 mx-auto bg-[var(--nimi-surface-canvas)] rounded-full h-1.5">
              <div
                className="bg-[var(--nimi-action-primary-bg)] h-1.5 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <Button
              tone="danger"
              size="sm"
              onClick={() => { xhrRef.current?.abort(); }}
            >
              {t('videoStudio.cancel', 'Cancel')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[var(--nimi-text-muted)]">
              {t('videoStudio.dropzone', 'Drag and drop video files here, or click to browse')}
            </p>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {t('videoStudio.formatHint', 'MP4, MOV, WebM')}
            </p>
            <Button
              tone="primary"
              size="md"
              onClick={() => fileInputRef.current?.click()}
            >
              {t('videoStudio.browse', 'Browse Files')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
        )}
      </div>

      {/* Upload error */}
      {uploadError && (
        <ForgeErrorBanner message={uploadError} />
      )}

      {/* Video list */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)] mb-3">
          {t('videoStudio.uploads', 'Uploaded Videos')}
          {videos.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[var(--nimi-text-muted)]">({videos.length})</span>
          )}
        </h3>
        {videos.length === 0 ? (
          <ForgeEmptyState message={t('videoStudio.noVideos', 'No videos uploaded yet.')} />
        ) : (
          <div className="space-y-2">
            {videos.map((video) => (
              <Surface
                key={video.id}
                tone="card"
                padding="sm"
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {video.storageRef ? (
                    <div className="h-10 w-14 flex-shrink-0 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-canvas)] overflow-hidden">
                      <iframe
                        src={`https://iframe.videodelivery.net/${video.storageRef}`}
                        className="h-full w-full"
                        allow="autoplay; fullscreen"
                        title={video.name}
                      />
                    </div>
                  ) : (
                    <div className="h-10 w-14 flex-shrink-0 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-canvas)] flex items-center justify-center">
                      <span className="text-xs text-[var(--nimi-text-muted)]">&#9654;</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--nimi-text-primary)] truncate">{video.name}</p>
                    <p className="text-xs text-[var(--nimi-text-muted)]">
                      {formatFileSize(video.size)} · {formatDate(video.uploadedAt)}
                    </p>
                  </div>
                </div>
                <Button
                  tone="danger"
                  size="sm"
                  onClick={() => setVideos((v) => v.filter((item) => item.id !== video.id))}
                >
                  {t('videoStudio.remove', 'Remove')}
                </Button>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </ForgePage>
  );
}
