/**
 * Video Studio Page (FG-CONTENT-002)
 *
 * Video upload with drag-and-drop, progress tracking, and preview.
 */

import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';
import { getVideoToken } from '@renderer/data/content-data-client.js';

type UploadedVideo = {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  uid?: string;
  playbackToken?: string;
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
      const result = await mutations.videoUploadMutation.mutateAsync();
      const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const uploadUrl = String(record.uploadUrl || '');
      const videoUid = String(record.uid || '');

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

      // Fetch playback token for preview
      let playbackToken: string | undefined;
      if (videoUid) {
        try {
          const tokenResult = await getVideoToken(videoUid);
          const tokenRecord = tokenResult && typeof tokenResult === 'object' ? (tokenResult as Record<string, unknown>) : {};
          playbackToken = tokenRecord.token ? String(tokenRecord.token) : undefined;
        } catch {
          // Token fetch is non-critical
        }
      }

      setVideos((prev) => [
        {
          id: videoUid || String(Date.now()),
          name: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          uid: videoUid || undefined,
          playbackToken,
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
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">{t('pages.videoStudio')}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t('videoStudio.subtitle', 'Upload and manage video content')}
          </p>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
            dragOver
              ? 'border-white bg-white/5'
              : 'border-neutral-700 bg-neutral-900/50 hover:border-neutral-500'
          }`}
        >
          {uploading ? (
            <div className="space-y-3">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
              <p className="text-sm text-white">{t('videoStudio.uploading', { progress: uploadProgress })}</p>
              <div className="w-64 mx-auto bg-neutral-800 rounded-full h-1.5">
                <div
                  className="bg-white h-1.5 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <button
                onClick={() => { xhrRef.current?.abort(); }}
                className="rounded px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                {t('videoStudio.cancel', 'Cancel')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-4xl text-neutral-700">📹</div>
              <p className="text-sm text-neutral-400">
                {t('videoStudio.dropzone', 'Drag and drop video files here, or click to browse')}
              </p>
              <p className="text-xs text-neutral-600">
                {t('videoStudio.formatHint', 'MP4, MOV, WebM')}
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 transition-colors"
              >
                {t('videoStudio.browse', 'Browse Files')}
              </button>
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
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-xs text-red-400">{uploadError}</p>
          </div>
        )}

        {/* Video list */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">
            {t('videoStudio.uploads', 'Uploaded Videos')}
            {videos.length > 0 && (
              <span className="ml-2 text-xs font-normal text-neutral-500">({videos.length})</span>
            )}
          </h3>
          {videos.length === 0 ? (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
              <p className="text-sm text-neutral-500">
                {t('videoStudio.noVideos', 'No videos uploaded yet.')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {video.playbackToken && video.uid ? (
                      <div className="h-10 w-14 flex-shrink-0 rounded bg-neutral-800 overflow-hidden">
                        <iframe
                          src={`https://customer-${video.uid}.cloudflarestream.com/${video.uid}/iframe?poster=https://customer-${video.uid}.cloudflarestream.com/${video.uid}/thumbnails/thumbnail.jpg`}
                          className="h-full w-full"
                          allow="autoplay; fullscreen"
                          title={video.name}
                        />
                      </div>
                    ) : (
                      <div className="h-10 w-14 flex-shrink-0 rounded bg-neutral-800 flex items-center justify-center">
                        <span className="text-xs text-neutral-500">▶</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{video.name}</p>
                      <p className="text-xs text-neutral-500">
                        {formatFileSize(video.size)} · {new Date(video.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setVideos((v) => v.filter((item) => item.id !== video.id))}
                    className="rounded px-3 py-1 text-xs font-medium text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  >
                    {t('videoStudio.remove', 'Remove')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
