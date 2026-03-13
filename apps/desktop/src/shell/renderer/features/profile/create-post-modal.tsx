import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
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

type CreatePostModalProps = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: { success: boolean; mode: 'create' | 'edit' }) => void;
  onUploadStart?: () => void; // Called when upload starts for optimistic UI
  initialPost?: EditablePostSeed | null;
};


export function CreatePostModal({ open, onClose, onComplete, onUploadStart, initialPost = null }: CreatePostModalProps) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [selectedMediaRef, setSelectedMediaRef] = useState<SelectedMediaRef | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [showLocationPanel, setShowLocationPanel] = useState(false);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [availableLocations, setAvailableLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const [emojiCategoryPage, setEmojiCategoryPage] = useState(0);
  const [locationSearch, setLocationSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const locationBtnRef = useRef<HTMLButtonElement>(null);
  const tagBtnRef = useRef<HTMLButtonElement>(null);
  const [emojiPanelPos, setEmojiPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [locationPanelPos, setLocationPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [tagPanelPos, setTagPanelPos] = useState<{ left: number; top: number } | null>(null);
  const isEditMode = Boolean(initialPost?.postId);

  // Popular tags for suggestions
  const POPULAR_TAGS = [
    'ai', 'design', 'music', 'art', 'photography', 'travel', 'food', 'fashion',
    'technology', 'gaming', 'sports', 'news', 'science', 'history', 'nature'
  ];

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
    if (selectedFile) URL.revokeObjectURL(selectedFile.previewUrl);
    setSelectedFile(null);
    setSelectedMediaRef(null);
    setCaption('');
    setUploading(false);
    setError(null);
    setDragOver(false);
    setShowEmojiPanel(false);
    setShowLocationPanel(false);
    setShowTagPanel(false);
    setSelectedLocation(null);
    setLocationSearch('');
    setTagSearch('');
    setSelectedTags([]);
  }, [selectedFile]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.previewUrl);
    }

    setSelectedFile(null);
    setError(null);
    setDragOver(false);
    setShowEmojiPanel(false);
    setShowLocationPanel(false);
    setShowTagPanel(false);
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
  }, [initialPost, open]);

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
    setShowLocationPanel(false);
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

  const toggleEmojiPanel = () => {
    const newValue = !showEmojiPanel;
    setShowEmojiPanel(newValue);
    setShowLocationPanel(false);
    setShowTagPanel(false);
    if (!showEmojiPanel && emojiBtnRef.current) {
      const rect = emojiBtnRef.current.getBoundingClientRect();
      setEmojiPanelPos({ left: rect.left, top: rect.bottom + 8 });
    }
  };

  const toggleLocationPanel = () => {
    const newValue = !showLocationPanel;
    setShowLocationPanel(newValue);
    setShowEmojiPanel(false);
    setShowTagPanel(false);
    if (!showLocationPanel && locationBtnRef.current) {
      const rect = locationBtnRef.current.getBoundingClientRect();
      setLocationPanelPos({ left: rect.left, top: rect.bottom + 8 });
    }
  };

  const toggleTagPanel = () => {
    const newValue = !showTagPanel;
    setShowTagPanel(newValue);
    setShowEmojiPanel(false);
    setShowLocationPanel(false);
    if (!showTagPanel && tagBtnRef.current) {
      const rect = tagBtnRef.current.getBoundingClientRect();
      setTagPanelPos({ left: rect.left, top: rect.bottom + 8 });
    }
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
          await fetch(upload.uploadUrl, {
            method: 'POST',
            body: formData,
          });
          mediaId = upload.imageId;
          mediaType = PostMediaType.IMAGE;
        } else {
          const uploadData = await dataSync.createVideoDirectUpload();
          const formData = new FormData();
          formData.append('file', activeMedia.file);
          await fetch(uploadData.uploadURL, {
            method: 'POST',
            body: formData,
          });
          mediaId = uploadData.uid;
          mediaType = PostMediaType.VIDEO;
        }
      } else {
        mediaId = activeMedia.id;
        mediaType = activeMedia.type === 'video' ? PostMediaType.VIDEO : PostMediaType.IMAGE;
      }

      const createdPost = await dataSync.createPost({
        media: [{
          type: mediaType,
          id: mediaId,
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

  // Close panels when clicking outside
  useEffect(() => {
    if (!showEmojiPanel && !showLocationPanel && !showTagPanel) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if click is inside emoji button wrapper (the div wrapping the button)
      const emojiWrapper = target.closest('.emoji-btn-wrapper');
      const locationWrapper = target.closest('.location-btn-wrapper');
      const tagWrapper = target.closest('.tag-btn-wrapper');
      
      if (!target.closest('.emoji-panel') && !emojiWrapper) {
        setShowEmojiPanel(false);
      }
      if (!target.closest('.location-panel') && !locationWrapper) {
        setShowLocationPanel(false);
      }
      if (!target.closest('.tag-panel') && !tagWrapper) {
        setShowTagPanel(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showEmojiPanel, showLocationPanel, showTagPanel]);

  // Update panel positions on window resize
  useEffect(() => {
    const handleResize = () => {
      if (showEmojiPanel && emojiBtnRef.current) {
        const rect = emojiBtnRef.current.getBoundingClientRect();
        setEmojiPanelPos({ left: rect.left, top: rect.bottom + 8 });
      }
      if (showLocationPanel && locationBtnRef.current) {
        const rect = locationBtnRef.current.getBoundingClientRect();
        setLocationPanelPos({ left: rect.left, top: rect.bottom + 8 });
      }
      if (showTagPanel && tagBtnRef.current) {
        const rect = tagBtnRef.current.getBoundingClientRect();
        setTagPanelPos({ left: rect.left, top: rect.bottom + 8 });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showEmojiPanel, showLocationPanel, showTagPanel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="relative mx-4 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => {
          e.stopPropagation();
          // Close panels when clicking inside modal but outside panels
          setShowEmojiPanel(false);
          setShowLocationPanel(false);
          setShowTagPanel(false);
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {isEditMode
              ? t('Profile.CreatePost.editPost', { defaultValue: 'Edit Post' })
              : t('Home.createPost', { defaultValue: 'Create Post' })}
          </h2>
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
          <div className="app-scroll-shell flex-1 overflow-y-auto px-5 py-4">
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

          {/* File Upload Area */}
          {!selectedFile && !selectedMediaRef ? (
            <div
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition ${
                dragOver ? 'border-[#4ECCA3] bg-[#4ECCA3]/10' : 'border-gray-300 bg-gray-50 hover:border-[#4ECCA3]'
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
              <p className="mt-1 text-xs text-gray-400">
                {t('Profile.CreatePost.supportedMediaTypes', {
                  defaultValue: 'PNG, JPEG, GIF, WebP, MP4, MOV (max 100MB)',
                })}
              </p>
            </div>
          ) : (
            <div className="relative">
              {/* Preview */}
              <div className="overflow-hidden rounded-xl bg-gray-100">
                {(selectedFile?.type ?? selectedMediaRef?.type) === 'image' ? (
                  <img
                    src={selectedFile?.previewUrl || selectedMediaRef?.previewUrl || ''}
                    alt="Preview"
                    className="mx-auto max-h-64 object-contain"
                  />
                ) : (
                  <video
                    src={selectedFile?.previewUrl || selectedMediaRef?.previewUrl || ''}
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
                  {selectedMediaRef && !selectedFile ? 'Replace' : 'Change'}
                </span>
              </button>
            </div>
          )}

          {/* Caption */}
          <div className="mt-4">
            <textarea
              ref={textareaRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
                    placeholder={t('Profile.CreatePost.writeCaptionPlaceholder', { defaultValue: 'Write a caption...' })}
              disabled={uploading}
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#4ECCA3] focus:ring-1 focus:ring-[#4ECCA3] focus:outline-none disabled:opacity-50"
            />
            
            {/* Selected Location Badge & Tags */}
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
                    className="inline-flex items-center gap-1 rounded-full bg-[#4ECCA3]/10 px-2 py-1 text-xs font-medium text-[#4ECCA3] hover:bg-[#4ECCA3]/20 transition-colors"
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
            
            {/* Action buttons */}
            <div className="relative mt-2 flex items-center gap-2">
              {/* Emoji button with tooltip */}
              <div className="relative emoji-btn-wrapper">
                <button
                  ref={emojiBtnRef}
                  type="button"
                  disabled={uploading}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleEmojiPanel();
                  }}
                  className={`emoji-btn group relative flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    showEmojiPanel
                      ? 'bg-[#0066CC] text-white'
                      : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
                  }`}
                  title={t('Profile.CreatePost.emoji', { defaultValue: 'Emoji' })}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                  <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {t('Profile.CreatePost.emoji', { defaultValue: 'Emoji' })}
                  </span>
                </button>
              </div>
              
              {/* Location button with tooltip */}
              <div className="relative location-btn-wrapper">
                <button
                  ref={locationBtnRef}
                  type="button"
                  disabled={uploading}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLocationPanel();
                  }}
                  className={`location-btn group relative flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    showLocationPanel
                      ? 'bg-[#0066CC] text-white'
                      : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
                  }`}
                  title={t('Profile.CreatePost.location', { defaultValue: 'Location' })}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {t('Profile.CreatePost.location', { defaultValue: 'Location' })}
                  </span>
                </button>
              </div>
              
              {/* Tag button with tooltip */}
              <div className="relative tag-btn-wrapper">
                <button
                  ref={tagBtnRef}
                  type="button"
                  disabled={uploading}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTagPanel();
                  }}
                  className={`tag-btn group relative flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    showTagPanel
                      ? 'bg-[#0066CC] text-white'
                      : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
                  }`}
                  title={t('Profile.CreatePost.tag', { defaultValue: 'Tag' })}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {t('Profile.CreatePost.tag', { defaultValue: 'Tag' })}
                  </span>
                </button>
              </div>
            </div>
            
            <div className="mt-2 flex items-center justify-end">
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
            disabled={(!selectedFile && !selectedMediaRef) || uploading}
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
    </div>
  );
}
