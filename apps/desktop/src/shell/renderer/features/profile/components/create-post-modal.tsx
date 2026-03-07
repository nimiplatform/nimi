import { useCallback, useRef, useState, useEffect } from 'react';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

type CreatePostModalProps = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: { success: boolean; mode: 'create' | 'edit' }) => void;
  onUploadStart?: () => void; // Called when upload starts for optimistic UI
  initialPost?: EditablePostSeed | null;
};

type SelectedFile = {
  file: File;
  previewUrl: string;
  type: 'image' | 'video';
};

type EditablePostSeed = {
  postId: string;
  caption?: string | null;
  tags?: string[] | null;
  visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  media?: {
    id: string;
    type: 'image' | 'video';
    previewUrl?: string | null;
  } | null;
};

type SelectedMediaRef = {
  id: string;
  type: 'image' | 'video';
  previewUrl: string;
};

function extractExistingMediaId(input: EditablePostSeed['media']): string {
  if (!input || typeof input !== 'object') {
    return '';
  }
  const payload = input as Record<string, unknown>;
  const candidates = [payload.id, payload.imageId, payload.videoId, payload.uid];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

type Location = {
  id: string;
  name: string;
  address: string;
};

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_CAPTION_LENGTH = 2000;
const MAX_TAGS = 5;
const CATEGORIES_PER_PAGE = 4;

// Common emojis grouped by category
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
  },
  {
    name: 'Gestures',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦵', '🦿', '🦶', '👣', '👂', '🦻', '👃', '🫀', '🫁', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸'],
  },
  {
    name: 'Love',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂', '🛂', '🛃', '🛄', '🛅', '🛗', '🚹', '🚺', '🚼', '⚧', '🚻', '🚮', '🎦', '📶', '🈁', '✖️', '➕', '➖', '➗', '♾️', '💱', '💲', '™️', '©️', '®️', '👁️‍🗨️', '🔚', '🔙', '🔛', '🔝', '🔜', '〰️', '➰', '➿', '✔️', '🆒', '🆓', '🆕', '🆗', '🆙', '🆖', '🈁', '🈶', '🈚', '🈷️', '🈸', '🈴', '🈳', '㊗️', '㊙️', '🈺', '🈵', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'],
  },
  {
    name: 'Nature',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🎍', '🎋', '🍃', '🍂', '🍁', '🍄', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏', '🪐', '💫', '⭐️', '🌟', '✨', '⚡️', '☄️', '💥', '🔥', '🌪️', '🌈', '☀️', '🌤️', '⛅️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄️', '🌬️', '💨', '💧', '💦', '☔️', '☂️', '🌊', '🌫️'],
  },
  {
    name: 'Food',
    emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🍍', '🥝', '🥑', '🍅', '🍆', '🥒', '🥕', '🌽', '🌶️', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🍡', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛', '☕️', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽️', '🥣', '🥡', '🥢', '🧂'],
  },
  {
    name: 'Activities',
    emojis: ['⚽️', '🏀', '🏈', '⚾️', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳️', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
  },
];

function mapWorldToLocation(raw: unknown): Location | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const name = String(record.name || '').trim();
  if (!id || !name) {
    return null;
  }
  const genre = String(record.genre || '').trim();
  const era = String(record.era || '').trim();
  const address = [genre, era].filter(Boolean).join(' · ') || 'Nimi World';
  return {
    id,
    name,
    address,
  };
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g);
  if (!matches) return [];
  return [...new Set(matches.map((t) => t.slice(1).toLowerCase().slice(0, 24)))].slice(0, MAX_TAGS);
}

function stripHashtags(text: string): string {
  return text.replace(/#[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, '').replace(/\s+/g, ' ').trim();
}

export function CreatePostModal({ open, onClose, onComplete, onUploadStart, initialPost = null }: CreatePostModalProps) {
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
  const activeCategory = EMOJI_CATEGORIES[activeEmojiCategory] ?? EMOJI_CATEGORIES[0] ?? {
    name: 'Default',
    emojis: [] as string[],
  };

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
          <h2 className="text-base font-semibold text-gray-900">{isEditMode ? 'Edit Post' : 'Create Post'}</h2>
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
              <p className="mt-1 text-xs text-gray-400">PNG, JPEG, GIF, WebP, MP4, MOV (max 100MB)</p>
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
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/58 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-black/72 disabled:opacity-50"
                title="Replace media"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
                  <polyline points="17 3 21 3 21 7" />
                  <line x1="16" y1="8" x2="21" y2="3" />
                  <circle cx="9" cy="13" r="2" />
                  <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L8 19" />
                </svg>
                {selectedMediaRef && !selectedFile ? 'Replace image' : 'Change image'}
              </button>
            </div>
          )}

          {/* Caption */}
          <div className="mt-4">
            <textarea
              ref={textareaRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              placeholder="Write a caption... Use #hashtags for tags"
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
                  title="Emoji"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                  {/* Tooltip */}
                  <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Emoji
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
                  title="Location"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {/* Tooltip */}
                  <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Location
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
                  title="Tag"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  {/* Tooltip */}
                  <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Tag
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

      {/* Emoji Panel - Fixed position, rendered outside modal */}
      {showEmojiPanel && emojiPanelPos && (
        <div
          className="emoji-panel fixed z-[100] w-[320px] rounded-2xl border border-gray-100 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden"
          style={{ left: emojiPanelPos.left, top: emojiPanelPos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Category tabs with pagination */}
          <div className="relative border-b border-gray-100">
            <div className="flex items-center gap-1 px-2 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {getCategoriesForPage(emojiCategoryPage).map((category) => (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => setActiveEmojiCategory(category.originalIndex)}
                    className={`flex-shrink-0 px-2.5 py-1.5 text-[11px] font-medium rounded-full transition-colors ${
                      activeEmojiCategory === category.originalIndex
                        ? 'bg-[#0066CC] text-white'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
              {totalCategoryPages > 1 ? (
                <button
                  type="button"
                  onClick={() => setEmojiPage(emojiCategoryPage === 0 ? emojiCategoryPage + 1 : emojiCategoryPage - 1)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  aria-label={emojiCategoryPage === 0 ? 'Next page' : 'Previous page'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {emojiCategoryPage === 0 ? (
                      <path d="M9 18l6-6-6-6" />
                    ) : (
                      <path d="M15 18l-6-6 6-6" />
                    )}
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
          {/* Emoji grid */}
          <div className="p-3 max-h-[260px] overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {activeCategory.emojis.map((emoji, index) => (
                <button
                  key={`${emoji}-${index}`}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="flex items-center justify-center h-8 w-8 text-xl hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Location Panel - Fixed position, rendered outside modal */}
      {showLocationPanel && locationPanelPos && (
        <div
          className="location-panel fixed z-[100] w-[320px] rounded-2xl border border-gray-100 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden"
          style={{ left: locationPanelPos.left, top: locationPanelPos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search location..."
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-[#4ECCA3] focus:outline-none focus:ring-1 focus:ring-[#4ECCA3]"
              />
            </div>
          </div>
          {/* Location list */}
          <div className="max-h-48 overflow-y-auto py-2">
            {loadingLocations ? (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                Loading locations...
              </div>
            ) : filteredLocations.length > 0 ? (
              filteredLocations.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => selectLocation(location)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 transition hover:bg-gray-50"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4ECCA3]/10 text-[#4ECCA3]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-gray-900">{location.name}</p>
                    <p className="truncate text-xs text-gray-500">{location.address}</p>
                  </div>
                  {selectedLocation?.id === location.id && (
                    <svg className="mt-1 h-4 w-4 text-[#4ECCA3]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                {availableLocations.length > 0 ? 'No locations found' : 'No worlds available'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tag Panel - Fixed position, rendered outside modal */}
      {showTagPanel && tagPanelPos && (
        <div
          className="tag-panel fixed z-[100] w-[280px] rounded-2xl border border-gray-100 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)] overflow-hidden"
          style={{ left: tagPanelPos.left, top: tagPanelPos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search or create a tag..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagSearch.trim()) {
                    insertTag(tagSearch.trim());
                  }
                }}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-[#4ECCA3] focus:outline-none focus:ring-1 focus:ring-[#4ECCA3]"
              />
            </div>
          </div>
          {/* Tag list */}
          <div className="max-h-48 overflow-y-auto py-2">
            {/* Existing tags */}
            {filteredTags.length > 0 && (
              <div className="mb-1">
                {filteredTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 transition hover:bg-gray-50"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4ECCA3]/10 text-[#4ECCA3]">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-gray-900">#{tag}</p>
                    </div>
                    {tags.includes(tag) && (
                      <svg className="h-4 w-4 text-[#4ECCA3]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
            
            {/* Create new tag option */}
            {tagSearch.trim() && !tags.includes(tagSearch.trim()) && (
              <button
                type="button"
                onClick={() => insertTag(tagSearch.trim())}
                className="flex w-full items-center gap-3 px-3 py-2.5 transition hover:bg-[#4ECCA3]/10 border-t border-gray-100"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4ECCA3]/10 text-[#4ECCA3]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-[#4ECCA3]">Create tag &quot;{tagSearch.trim()}&quot;</p>
                </div>
              </button>
            )}
            
            {/* Empty state */}
            {!tagSearch.trim() && filteredTags.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                Type to search or create a new tag
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
