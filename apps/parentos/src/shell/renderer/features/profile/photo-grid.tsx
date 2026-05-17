import { DashedAddButton } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import { readImageFileAsDataUrl } from './checkup-ocr.js';

export type PendingPhoto = {
  base64: string;
  mimeType: string;
  fileName: string;
};

type PhotoGridProps = {
  photos: PendingPhoto[];
  maxPhotos: number;
  hint?: string;
  onChange: (next: PendingPhoto[]) => void;
};

export function PhotoGrid({ photos, maxPhotos, hint, onChange }: PhotoGridProps) {
  const [dragOver, setDragOver] = useState(false);
  const total = photos.length;
  const isEmpty = total === 0;
  const canAddMore = total < maxPhotos;

  const appendFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const remaining = maxPhotos - total;
    if (remaining <= 0) return;
    const toProcess = list.slice(0, remaining);
    const next: PendingPhoto[] = [];
    for (const file of toProcess) {
      try {
        const base64 = await readImageFileAsDataUrl(file);
        next.push({ base64, mimeType: file.type || 'image/jpeg', fileName: file.name });
      } catch {
        /* ignore unreadable file */
      }
    }
    if (next.length > 0) onChange([...photos, ...next]);
  };

  const pickFiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      if (input.files) await appendFiles(input.files);
    };
    input.click();
  };

  const removeAt = (idx: number) => {
    onChange(photos.filter((_, i) => i !== idx));
  };

  return (
    <div
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer.files?.length) await appendFiles(event.dataTransfer.files);
      }}
      className="grid grid-cols-3 gap-2"
    >
      {photos.map((photo, idx) => (
        <div key={idx} className="group relative">
          <img src={photo.base64} alt={`preview-${idx}`} className={`h-24 w-full object-cover ${"rounded-2xl"}`} />
          <button
            type="button"
            onClick={() => removeAt(idx)}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--nimi-surface-overlay)] text-[12px] text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-base)] transition-opacity group-hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
      {canAddMore ? (
        <DashedAddButton
          shape="tile"
          active={dragOver}
          onClick={pickFiles}
          className={isEmpty ? 'col-span-3' : undefined}
          label={isEmpty ? hint ?? `点击或拖拽上传照片（最多 ${maxPhotos} 张）` : '添加更多'}
        />
      ) : null}
    </div>
  );
}
