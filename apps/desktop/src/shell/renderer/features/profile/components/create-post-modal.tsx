import { useCallback, useRef, useState } from 'react';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';

type CreatePostModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type SelectedFile = {
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
};

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_CAPTION_LENGTH = 2000;
const MAX_TAGS = 5;

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g);
  if (!matches) return [];
  return [...new Set(matches.map((t) => t.slice(1).toLowerCase().slice(0, 24)))].slice(0, MAX_TAGS);
}

function stripHashtags(text: string): string {
  return text.replace(/#[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, '').replace(/\s+/g, ' ').trim();
}

export function CreatePostModal({ open, onClose, onCreated }: CreatePostModalProps) {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tags = extractHashtags(caption);

  const reset = useCallback(() => {
    if (selectedFile) URL.revokeObjectURL(selectedFile.previewUrl);
    setSelectedFile(null);
    setCaption('');
    setUploading(false);
    setError(null);
    setDragOver(false);
  }, [selectedFile]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFileSelect = useCallback((file: File) => {
    setError(null);

    if (file.size > MAX_FILE_SIZE) {
      setError('File size exceeds 100MB limit');
      return;
    }

    const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
    const isVideo = ACCEPTED_VIDEO_TYPES.includes(file.type);

    if (!isImage && !isVideo) {
      setError('Unsupported file type. Use PNG, JPEG, GIF, WebP, MP4, or MOV.');
      return;
    }

    if (selectedFile) URL.revokeObjectURL(selectedFile.previewUrl);

    setSelectedFile({
      file,
      previewUrl: URL.createObjectURL(file),
      type: isImage ? 'image' : 'video',
    });
  }, [selectedFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);

    try {
      let mediaId: string;

      if (selectedFile.type === 'image') {
        // 1. Get upload credentials
        const upload = await dataSync.createImageDirectUpload();
        // 2. Upload file to Cloudflare
        const formData = new FormData();
        formData.append('file', selectedFile.file);
        await fetch(upload.uploadUrl, {
          method: 'POST',
          body: formData,
        });
        mediaId = upload.imageId;
      } else {
        // Video upload
        const uploadData = await dataSync.createVideoDirectUpload();
        const formData = new FormData();
        formData.append('file', selectedFile.file);
        await fetch(uploadData.uploadURL, {
          method: 'POST',
          body: formData,
        });
        mediaId = uploadData.uid;
      }

      // 3. Create post
      await dataSync.createPost({
        media: [{
          type: selectedFile.type === 'image' ? PostMediaType.IMAGE : PostMediaType.VIDEO,
          id: mediaId,
        }],
        caption: stripHashtags(caption) || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      handleClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create post. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [selectedFile, caption, tags, handleClose, onCreated]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="relative mx-4 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Create Post</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* File Upload Area */}
          {!selectedFile ? (
            <div
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition ${
                dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-400">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="text-sm font-medium text-gray-700">
                {dragOver ? 'Drop file here' : 'Click or drag to upload'}
              </p>
              <p className="mt-1 text-xs text-gray-400">PNG, JPEG, GIF, WebP, MP4, MOV (max 100MB)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <div className="relative">
              {/* Preview */}
              <div className="overflow-hidden rounded-xl bg-gray-100">
                {selectedFile.type === 'image' ? (
                  <img
                    src={selectedFile.previewUrl}
                    alt="Preview"
                    className="mx-auto max-h-64 object-contain"
                  />
                ) : (
                  <video
                    src={selectedFile.previewUrl}
                    controls
                    className="mx-auto max-h-64"
                  />
                )}
              </div>
              {/* Replace file */}
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(selectedFile.previewUrl);
                  setSelectedFile(null);
                }}
                disabled={uploading}
                className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white transition hover:bg-black/70 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {/* Caption */}
          <div className="mt-4">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              placeholder="Write a caption... Use #hashtags for tags"
              disabled={uploading}
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-400 focus:ring-1 focus:ring-brand-400 focus:outline-none disabled:opacity-50"
            />
            <div className="mt-1 flex items-center justify-between">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600">
                    #{tag}
                  </span>
                ))}
              </div>
              <span className="text-xs text-gray-400">{caption.length}/{MAX_CAPTION_LENGTH}</span>
            </div>
          </div>

          {/* Error */}
          {error ? (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="rounded-[10px] px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={!selectedFile || uploading}
            className="flex items-center gap-2 rounded-[10px] bg-brand-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                </svg>
                Posting...
              </>
            ) : (
              'Post'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
