import { useRef, useState } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { uploadFileAsResource, type FileUploadResult } from '@renderer/data/content-data-client.js';

type ImageUploadFieldProps = {
  label: string;
  currentUrl?: string | null;
  aspect?: '1:1' | '16:9' | '9:16';
  onUploaded: (result: { resourceId: string; url: string }) => void;
  disabled?: boolean;
};

const ASPECT_CLASS: Record<string, string> = {
  '1:1': 'aspect-square',
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
};

export function ImageUploadField({
  label,
  currentUrl,
  aspect = '1:1',
  onUploaded,
  disabled,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const result: FileUploadResult = await uploadFileAsResource(file);
      onUploaded(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-[var(--nimi-text-secondary)]">
        {label}
      </label>

      <Surface tone="card" padding="none">
        <div
          className={`relative overflow-hidden rounded-lg ${ASPECT_CLASS[aspect]} w-full max-w-[200px] bg-[var(--nimi-surface-base)]`}
        >
          {currentUrl ? (
            <img
              src={currentUrl}
              alt={label}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-[var(--nimi-text-muted)]">
              No image
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity hover:opacity-100">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || uploading}
            >
              {uploading ? 'Uploading...' : currentUrl ? 'Change' : 'Upload'}
            </Button>
          </div>
        </div>
      </Surface>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFileChange(e)}
      />

      {error ? (
        <p className="text-xs text-[var(--nimi-status-error)]">{error}</p>
      ) : null}
    </div>
  );
}
