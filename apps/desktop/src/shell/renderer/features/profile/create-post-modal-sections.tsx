import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { MAX_CAPTION_LENGTH, type Location, type SelectedAttachmentRef, type SelectedFile } from './create-post-modal-helpers.js';

type CreatePostModalHeaderProps = {
  isEditMode: boolean;
  uploading: boolean;
  onClose: () => void;
  t: TFunction;
};

export function CreatePostModalHeader({ isEditMode, uploading, onClose, t }: CreatePostModalHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
      <h2 className="text-base font-semibold text-gray-900">
        {isEditMode
          ? t('Profile.CreatePost.editPost', { defaultValue: 'Edit Post' })
          : t('Home.createPost', { defaultValue: 'Create Post' })}
      </h2>
      <button
        type="button"
        onClick={onClose}
        disabled={uploading}
        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

type CreatePostAttachmentSectionProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  selectedFile: SelectedFile | null;
  selectedAttachmentRef: SelectedAttachmentRef | null;
  dragOver: boolean;
  uploading: boolean;
  setDragOver: (value: boolean) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleFileSelect: (file: File) => void;
  t: TFunction;
};

export function CreatePostAttachmentSection({
  fileInputRef,
  selectedFile,
  selectedAttachmentRef,
  dragOver,
  uploading,
  setDragOver,
  handleDrop,
  handleFileSelect,
  t,
}: CreatePostAttachmentSectionProps) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFileSelect(file);
          }
          event.target.value = '';
        }}
      />

      {!selectedFile && !selectedAttachmentRef ? (
        <div
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition ${
            dragOver ? 'border-[#4ECCA3] bg-[#4ECCA3]/10' : 'border-gray-300 bg-gray-50 hover:border-[#4ECCA3]'
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
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
          <p className="mt-1 text-xs text-gray-400">
            {t('Profile.CreatePost.supportedMediaTypes', {
              defaultValue: 'PNG, JPEG, GIF, WebP, MP4, MOV (max 100MB)',
            })}
          </p>
        </div>
      ) : (
        <div className="relative">
          <div className="overflow-hidden rounded-xl bg-gray-100">
            {(selectedFile?.type ?? selectedAttachmentRef?.type) === 'image' ? (
              <img
                src={selectedFile?.previewUrl || selectedAttachmentRef?.previewUrl || ''}
                alt="Preview"
                className="mx-auto max-h-64 object-contain"
              />
            ) : (
              <video
                src={selectedFile?.previewUrl || selectedAttachmentRef?.previewUrl || ''}
                controls
                className="mx-auto max-h-64"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="group absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm ring-1 ring-white/10 transition-all duration-200 hover:bg-[#4ECCA3] hover:ring-[#4ECCA3]/50 disabled:opacity-50"
            title={t('Profile.CreatePost.replaceMedia', { defaultValue: 'Replace media' })}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-200 group-hover:rotate-12"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="hidden sm:inline">
              {selectedAttachmentRef && !selectedFile ? 'Replace' : 'Change'}
            </span>
          </button>
        </div>
      )}
    </>
  );
}

type CreatePostCaptionSectionProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  caption: string;
  selectedLocation: Location | null;
  tags: string[];
  selectedTags: string[];
  uploading: boolean;
  showEmojiPanel: boolean;
  showLocationPanel: boolean;
  showTagPanel: boolean;
  emojiBtnRef: RefObject<HTMLButtonElement | null>;
  locationBtnRef: RefObject<HTMLButtonElement | null>;
  tagBtnRef: RefObject<HTMLButtonElement | null>;
  setCaption: (value: string) => void;
  removeLocation: () => void;
  removeTag: (tag: string) => void;
  toggleEmojiPanel: () => void;
  toggleLocationPanel: () => void;
  toggleTagPanel: () => void;
  t: TFunction;
};

export function CreatePostCaptionSection({
  textareaRef,
  caption,
  selectedLocation,
  tags,
  selectedTags,
  uploading,
  showEmojiPanel,
  showLocationPanel,
  showTagPanel,
  emojiBtnRef,
  locationBtnRef,
  tagBtnRef,
  setCaption,
  removeLocation,
  removeTag,
  toggleEmojiPanel,
  toggleLocationPanel,
  toggleTagPanel,
  t,
}: CreatePostCaptionSectionProps) {
  return (
    <div className="mt-4">
      <textarea
        ref={textareaRef}
        value={caption}
        onChange={(event) => setCaption(event.target.value.slice(0, MAX_CAPTION_LENGTH))}
        placeholder={t('Profile.CreatePost.writeCaptionPlaceholder', { defaultValue: 'Write a caption...' })}
        disabled={uploading}
        rows={3}
        className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#4ECCA3] focus:ring-1 focus:ring-[#4ECCA3] focus:outline-none disabled:opacity-50"
      />

      {(selectedLocation || tags.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {selectedLocation && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#4ECCA3]/10 px-3 py-1 text-sm text-[#4ECCA3]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {selectedLocation.name}
              <button
                type="button"
                onClick={removeLocation}
                className="ml-1 rounded-full hover:bg-[#4ECCA3]/20"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          )}
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="inline-flex items-center gap-1 rounded-full bg-[#4ECCA3]/10 px-2 py-1 text-xs font-medium text-[#4ECCA3] transition-colors hover:bg-[#4ECCA3]/20"
            >
              #{tag}
              {selectedTags.includes(tag) && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-2 flex items-center gap-2">
        <TooltipButton
          wrapperClassName="emoji-btn-wrapper"
          buttonRef={emojiBtnRef}
          active={showEmojiPanel}
          disabled={uploading}
          label={t('Profile.CreatePost.emoji', { defaultValue: 'Emoji' })}
          onClick={(event) => {
            event.stopPropagation();
            toggleEmojiPanel();
          }}
          icon={(
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          )}
        />
        <TooltipButton
          wrapperClassName="location-btn-wrapper"
          buttonRef={locationBtnRef}
          active={showLocationPanel}
          disabled={uploading}
          label={t('Profile.CreatePost.location', { defaultValue: 'Location' })}
          onClick={(event) => {
            event.stopPropagation();
            toggleLocationPanel();
          }}
          icon={(
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          )}
        />
        <TooltipButton
          wrapperClassName="tag-btn-wrapper"
          buttonRef={tagBtnRef}
          active={showTagPanel}
          disabled={uploading}
          label={t('Profile.CreatePost.tag', { defaultValue: 'Tag' })}
          onClick={(event) => {
            event.stopPropagation();
            toggleTagPanel();
          }}
          icon={(
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          )}
        />
      </div>

      <div className="mt-2 flex items-center justify-end">
        <span className="text-xs text-gray-400">{caption.length}/{MAX_CAPTION_LENGTH}</span>
      </div>
    </div>
  );
}

type CreatePostModalFooterProps = {
  selectedFile: SelectedFile | null;
  selectedAttachmentRef: SelectedAttachmentRef | null;
  uploading: boolean;
  isEditMode: boolean;
  onClose: () => void;
  onSubmit: () => void;
};

export function CreatePostModalFooter({
  selectedFile,
  selectedAttachmentRef,
  uploading,
  isEditMode,
  onClose,
  onSubmit,
}: CreatePostModalFooterProps) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-5 py-4">
      <button
        type="button"
        onClick={onClose}
        disabled={uploading}
        className="rounded-[10px] px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={(!selectedFile && !selectedAttachmentRef) || uploading}
        className="flex items-center gap-2 rounded-[10px] bg-[#4ECCA3] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#3dbb92] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {uploading ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
            {isEditMode ? 'Saving...' : 'Posting...'}
          </>
        ) : (
          isEditMode ? 'Save' : 'Post'
        )}
      </button>
    </div>
  );
}

export function CreatePostModalBody(props: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  selectedFile: SelectedFile | null;
  selectedAttachmentRef: SelectedAttachmentRef | null;
  dragOver: boolean;
  uploading: boolean;
  caption: string;
  selectedLocation: Location | null;
  tags: string[];
  selectedTags: string[];
  showEmojiPanel: boolean;
  showLocationPanel: boolean;
  showTagPanel: boolean;
  emojiBtnRef: RefObject<HTMLButtonElement | null>;
  locationBtnRef: RefObject<HTMLButtonElement | null>;
  tagBtnRef: RefObject<HTMLButtonElement | null>;
  setDragOver: (value: boolean) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleFileSelect: (file: File) => void;
  setCaption: (value: string) => void;
  removeLocation: () => void;
  removeTag: (tag: string) => void;
  toggleEmojiPanel: () => void;
  toggleLocationPanel: () => void;
  toggleTagPanel: () => void;
  t: TFunction;
}) {
  return (
    <ScrollArea className="flex-1" contentClassName="px-5 py-4">
      <CreatePostAttachmentSection
        fileInputRef={props.fileInputRef}
        selectedFile={props.selectedFile}
        selectedAttachmentRef={props.selectedAttachmentRef}
        dragOver={props.dragOver}
        uploading={props.uploading}
        setDragOver={props.setDragOver}
        handleDrop={props.handleDrop}
        handleFileSelect={props.handleFileSelect}
        t={props.t}
      />
      <CreatePostCaptionSection
        textareaRef={props.textareaRef}
        caption={props.caption}
        selectedLocation={props.selectedLocation}
        tags={props.tags}
        selectedTags={props.selectedTags}
        uploading={props.uploading}
        showEmojiPanel={props.showEmojiPanel}
        showLocationPanel={props.showLocationPanel}
        showTagPanel={props.showTagPanel}
        emojiBtnRef={props.emojiBtnRef}
        locationBtnRef={props.locationBtnRef}
        tagBtnRef={props.tagBtnRef}
        setCaption={props.setCaption}
        removeLocation={props.removeLocation}
        removeTag={props.removeTag}
        toggleEmojiPanel={props.toggleEmojiPanel}
        toggleLocationPanel={props.toggleLocationPanel}
        toggleTagPanel={props.toggleTagPanel}
        t={props.t}
      />
    </ScrollArea>
  );
}

function TooltipButton(props: {
  wrapperClassName: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  active: boolean;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className={`relative ${props.wrapperClassName}`}>
      <button
        ref={props.buttonRef}
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
        className={`group relative flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
          props.active ? 'bg-[#0066CC] text-white' : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
        }`}
        title={props.label}
      >
        {props.icon}
        <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
          {props.label}
        </span>
      </button>
    </div>
  );
}
