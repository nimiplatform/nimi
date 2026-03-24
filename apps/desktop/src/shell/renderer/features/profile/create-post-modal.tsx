import { useCallback, useRef, useState, useEffect } from 'react';
import { OverlayShell } from '@nimiplatform/nimi-ui';
import { useTranslation } from 'react-i18next';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  CATEGORIES_PER_PAGE,
  type EditablePostSeed,
  EMOJI_CATEGORIES,
  extractExistingMediaId,
  extractHashtags,
  type Location,
  mapWorldToLocation,
  MAX_CAPTION_LENGTH,
  MAX_FILE_SIZE,
  type SelectedFile,
  type SelectedMediaRef,
  stripHashtags,
} from './create-post-modal-helpers.js';
import {
  EmojiPickerPanel,
  LocationPickerPanel,
  TagPickerPanel,
} from './create-post-modal-panels.js';
import {
  CreatePostModalBody,
  CreatePostModalFooter,
  CreatePostModalHeader,
} from './create-post-modal-sections.js';
import { useCreatePostModalPanelState } from './create-post-modal-panel-state.js';

type CreatePostModalProps = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: { success: boolean; mode: 'create' | 'edit' }) => void;
  onUploadStart?: () => void; // Called when upload starts for optimistic UI
  initialPost?: EditablePostSeed | null;
};

const POPULAR_TAGS = [
  'ai', 'design', 'music', 'art', 'photography', 'travel', 'food', 'fashion',
  'technology', 'gaming', 'sports', 'news', 'science', 'history', 'nature',
];

export function CreatePostModal({ open, onClose, onComplete, onUploadStart, initialPost = null }: CreatePostModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const locationBtnRef = useRef<HTMLButtonElement>(null);
  const tagBtnRef = useRef<HTMLButtonElement>(null);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;
  const [selectedMediaRef, setSelectedMediaRef] = useState<SelectedMediaRef | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [availableLocations, setAvailableLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const [emojiCategoryPage, setEmojiCategoryPage] = useState(0);
  const [locationSearch, setLocationSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const isEditMode = Boolean(initialPost?.postId);
  const {
    showEmojiPanel,
    showLocationPanel,
    showTagPanel,
    emojiPanelPos,
    locationPanelPos,
    tagPanelPos,
    toggleEmojiPanel,
    toggleLocationPanel,
    toggleTagPanel,
    closeAllPanels,
  } = useCreatePostModalPanelState({
    open,
    emojiButtonRef: emojiBtnRef,
    locationButtonRef: locationBtnRef,
    tagButtonRef: tagBtnRef,
  });

  const filteredTags = tagSearch.trim()
    ? POPULAR_TAGS.filter(tag => tag.toLowerCase().includes(tagSearch.toLowerCase()))
    : POPULAR_TAGS;

  // Emoji pagination
  const totalCategoryPages = Math.ceil(EMOJI_CATEGORIES.length / CATEGORIES_PER_PAGE);

  // Get categories for current page
  const getCategoriesForPage = (page: number) => {
    const start = page * CATEGORIES_PER_PAGE;
    const end = start + CATEGORIES_PER_PAGE;
    return EMOJI_CATEGORIES.slice(start, end).map((cat, idx) => ({
      ...cat,
      originalIndex: start + idx
    }));
  };

  const setEmojiPage = (page: number) => {
    const boundedPage = Math.max(0, Math.min(totalCategoryPages - 1, page));
    const nextPageCategories = getCategoriesForPage(boundedPage);
    setEmojiCategoryPage(boundedPage);
    if (nextPageCategories[0]) {
      setActiveEmojiCategory(nextPageCategories[0].originalIndex);
    }
  };

  // Get hashtags from caption and merge with selected tags
  const captionTags = extractHashtags(caption);
  const tags = [...new Set([...selectedTags, ...captionTags])];

  const filteredLocations = availableLocations.filter(
    (loc) =>
      loc.name.toLowerCase().includes(locationSearch.toLowerCase()) ||
      loc.address.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const reset = useCallback(() => {
    if (selectedFileRef.current) URL.revokeObjectURL(selectedFileRef.current.previewUrl);
    setSelectedFile(null);
    setSelectedMediaRef(null);
    setCaption('');
    setUploading(false);
    setError(null);
    setDragOver(false);
    closeAllPanels();
    setSelectedLocation(null);
    setLocationSearch('');
    setTagSearch('');
    setSelectedTags([]);
  }, [closeAllPanels]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (selectedFileRef.current) {
      URL.revokeObjectURL(selectedFileRef.current.previewUrl);
    }

    setSelectedFile(null);
    setError(null);
    setDragOver(false);
    closeAllPanels();
    setSelectedLocation(null);
    setLocationSearch('');
    setTagSearch('');

    if (initialPost) {
      setCaption(String(initialPost.caption || ''));
      setSelectedTags(Array.isArray(initialPost.tags) ? initialPost.tags.map(String) : []);
      const mediaId = extractExistingMediaId(initialPost.media);
      const mediaType = initialPost.media?.type === 'video' ? 'video' : 'image';
      const previewUrl = String(initialPost.media?.previewUrl || '').trim();
      setSelectedMediaRef(mediaId || previewUrl ? {
        id: mediaId,
        type: mediaType,
        previewUrl,
      } : null);
      return;
    }

    setCaption('');
    setSelectedTags([]);
    setSelectedMediaRef(null);
  }, [closeAllPanels, initialPost, open]);

  useEffect(() => {
    return () => {
      if (selectedFileRef.current) {
        URL.revokeObjectURL(selectedFileRef.current.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    let canceled = false;
    setLoadingLocations(true);
    void dataSync.loadWorlds()
      .then((payload) => {
        if (canceled) {
          return;
        }
        const normalized = Array.isArray(payload)
          ? payload
            .map((item) => mapWorldToLocation(item))
            .filter((item): item is Location => item !== null)
          : [];
        setAvailableLocations(normalized);
      })
      .catch(() => {
        if (!canceled) {
          setAvailableLocations([]);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingLocations(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [open]);

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
    setSelectedMediaRef(null);

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

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newCaption = caption.slice(0, start) + emoji + caption.slice(end);
    
    if (newCaption.length <= MAX_CAPTION_LENGTH) {
      setCaption(newCaption);
      // Restore focus and set cursor position after emoji
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    }
  };

  const selectLocation = (location: Location) => {
    setSelectedLocation(location);
    closeAllPanels();
  };

  const removeLocation = () => {
    setSelectedLocation(null);
  };

  const insertTag = (tag: string) => {
    // Add tag to selected tags list (displayed below input, not in caption)
    setSelectedTags((prev) => {
      if (prev.includes(tag)) return prev;
      return [...prev, tag];
    });
    setTagSearch('');
    // Don't close panel after selecting tag to allow multiple selection
  };

  const removeTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSubmit = useCallback(async () => {
    const activeMedia = selectedFile || selectedMediaRef;
    if (!activeMedia || (!('file' in activeMedia) && !activeMedia.id)) return;
    
    // Optimistic UI: notify parent that upload has started
    onUploadStart?.();
    
    // Close modal immediately for better UX
    handleClose();
    
    // Continue upload in background
    try {
      let mediaId: string;
      let mediaType: PostMediaType;
      
      if ('file' in activeMedia) {
        if (activeMedia.type === 'image') {
          const upload = await dataSync.createImageDirectUpload();
          const formData = new FormData();
          formData.append('file', activeMedia.file);
          const uploadResponse = await fetch(upload.uploadUrl, {
            method: 'POST',
            body: formData,
          });
          if (!uploadResponse.ok) {
            throw new Error('Image upload failed');
          }
          await dataSync.finalizeMediaAsset(upload.assetId, {});
          mediaId = upload.assetId;
          mediaType = PostMediaType.IMAGE;
        } else {
          const uploadData = await dataSync.createVideoDirectUpload();
          const formData = new FormData();
          formData.append('file', activeMedia.file);
          const uploadResponse = await fetch(uploadData.uploadUrl, {
            method: 'POST',
            body: formData,
          });
          if (!uploadResponse.ok) {
            throw new Error('Video upload failed');
          }
          await dataSync.finalizeMediaAsset(uploadData.assetId, {});
          mediaId = uploadData.assetId;
          mediaType = PostMediaType.VIDEO;
        }
      } else {
        mediaId = activeMedia.id;
        mediaType = activeMedia.type === 'video' ? PostMediaType.VIDEO : PostMediaType.IMAGE;
      }

      const createdPost = await dataSync.createPost({
        media: [{
          type: mediaType,
          assetId: mediaId,
        }],
        caption: stripHashtags(caption) || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      if (initialPost?.postId) {
        const createdPostId = String((createdPost as { id?: string } | null)?.id || '').trim();
        if (initialPost.visibility && initialPost.visibility !== 'PUBLIC') {
          if (!createdPostId) {
            throw new Error('Updated post was created without an id, visibility could not be restored.');
          }
          await dataSync.updatePostVisibility(createdPostId, initialPost.visibility);
        }
        await dataSync.deletePost(initialPost.postId);
      }

      onComplete({ success: true, mode: isEditMode ? 'edit' : 'create' });
    } catch (err) {
      logRendererEvent({
        level: 'error',
        area: 'profile',
        message: 'action:create-post:failed',
        details: { error: String(err) },
      });
      onComplete({ success: false, mode: isEditMode ? 'edit' : 'create' });
    }
  }, [selectedFile, selectedMediaRef, onUploadStart, handleClose, caption, tags, initialPost, onComplete, isEditMode]);

  if (!open) return null;

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      onClose={handleClose}
      dataTestId={E2E_IDS.createPostDialog}
      panelClassName="max-w-lg overflow-hidden rounded-2xl"
      contentClassName="p-0"
    >
      <div
        className="relative flex max-h-[90vh] w-full flex-col overflow-hidden bg-white shadow-xl"
        onClick={() => {
          closeAllPanels();
        }}
      >
        <CreatePostModalHeader
          isEditMode={isEditMode}
          uploading={uploading}
          onClose={handleClose}
          t={t}
        />
        <CreatePostModalBody
          fileInputRef={fileInputRef}
          textareaRef={textareaRef}
          selectedFile={selectedFile}
          selectedMediaRef={selectedMediaRef}
          dragOver={dragOver}
          uploading={uploading}
          caption={caption}
          selectedLocation={selectedLocation}
          tags={tags}
          selectedTags={selectedTags}
          showEmojiPanel={showEmojiPanel}
          showLocationPanel={showLocationPanel}
          showTagPanel={showTagPanel}
          emojiBtnRef={emojiBtnRef}
          locationBtnRef={locationBtnRef}
          tagBtnRef={tagBtnRef}
          setDragOver={setDragOver}
          handleDrop={handleDrop}
          handleFileSelect={handleFileSelect}
          setCaption={setCaption}
          removeLocation={removeLocation}
          removeTag={removeTag}
          toggleEmojiPanel={toggleEmojiPanel}
          toggleLocationPanel={toggleLocationPanel}
          toggleTagPanel={toggleTagPanel}
          t={t}
        />

        {error ? (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        ) : null}

        <CreatePostModalFooter
          selectedFile={selectedFile}
          selectedMediaRef={selectedMediaRef}
          uploading={uploading}
          isEditMode={isEditMode}
          onClose={handleClose}
          onSubmit={() => { void handleSubmit(); }}
        />
      </div>

      <EmojiPickerPanel
        show={showEmojiPanel}
        position={emojiPanelPos}
        categories={getCategoriesForPage(emojiCategoryPage)}
        activeEmojiCategory={activeEmojiCategory}
        totalCategoryPages={totalCategoryPages}
        emojiCategoryPage={emojiCategoryPage}
        setActiveEmojiCategory={setActiveEmojiCategory}
        setEmojiPage={setEmojiPage}
        insertEmoji={insertEmoji}
      />

      <LocationPickerPanel
        show={showLocationPanel}
        position={locationPanelPos}
        loadingLocations={loadingLocations}
        locationSearch={locationSearch}
        setLocationSearch={setLocationSearch}
        filteredLocations={filteredLocations}
        availableLocations={availableLocations}
        selectedLocation={selectedLocation}
        selectLocation={selectLocation}
      />

      <TagPickerPanel
        show={showTagPanel}
        position={tagPanelPos}
        tagSearch={tagSearch}
        setTagSearch={setTagSearch}
        filteredTags={filteredTags}
        tags={tags}
        insertTag={insertTag}
      />
    </OverlayShell>
  );
}
