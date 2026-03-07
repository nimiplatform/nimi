import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { MessageType } from '@nimiplatform/sdk/realm';

// Common emoji categories
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾']
  },
  {
    name: 'Gestures',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦵', '🦿', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸']
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂', '🛂', '🛃', '🛄', '🛅', '🛗', '🧭', '🚹', '🚺', '🚼', '⚧', '🚻', '🚮', '🎦', '📶', '🈁', '✴️', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '⬛', '⬜', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬜', '⬛']
  },
  {
    name: 'Animals',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🎍', '🎋', '🍃', '🍂', '🍁', '🍄', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏', '🪐', '💫', '⭐', '🌟', '✨', '⚡', '🔥', '💥', '☄️', '☀️', '🌤️', '⛅', '🌦️', '🌈', '☁️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '💨', '💧', '💦', '☔', '☂️', '🌊', '🌫️']
  },
  {
    name: 'Food',
    emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽️', '🥣', '🥡', '🥢', '🧂']
  },
  {
    name: 'Activities',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩']
  },
  {
    name: 'Objects',
    emojis: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💎', '🔔', '🔕', '📢', '📣', '📯', '💬', '💭', '💤', '🗯️', '♠️', '♥️', '♦️', '♣️', '🃏', '🎴', '🀄']
  }
];

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      return {
        width: Math.max(1, Math.floor(bitmap.width || 0)),
        height: Math.max(1, Math.floor(bitmap.height || 0)),
      };
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image-metadata-read-failed'));
      img.src = objectUrl;
    });
    return {
      width: Math.max(1, Math.floor(image.naturalWidth || image.width || 0)),
      height: Math.max(1, Math.floor(image.naturalHeight || image.height || 0)),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function readVideoMetadata(file: File): Promise<{ width: number; height: number; duration: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const metadata = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve({
          width: Math.max(1, Math.floor(video.videoWidth || 0)),
          height: Math.max(1, Math.floor(video.videoHeight || 0)),
          duration: Math.max(0, Math.floor(video.duration || 0)),
        });
      };
      video.onerror = () => reject(new Error('video-metadata-read-failed'));
      video.src = objectUrl;
    });
    return metadata;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type TurnInputProps = {
  className?: string;
  showTopBorder?: boolean;
};

export function TurnInput(props: TurnInputProps = {}) {
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState(0);
  const [emojiCategoryPage, setEmojiCategoryPage] = useState(0);
  const [showUploadPickerActive, setShowUploadPickerActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pastedImage, setPastedImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const context = useUiExtensionContext();

  // Categories per page
  const CATEGORIES_PER_PAGE = 4;
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

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  useEffect(() => () => {
    if (pastedImage) {
      URL.revokeObjectURL(pastedImage.previewUrl);
    }
  }, [pastedImage]);

  useEffect(() => {
    if (!showUploadPickerActive) {
      return;
    }

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        setShowUploadPickerActive(false);
      }, 120);
    };

    window.addEventListener('focus', handleWindowFocus, true);
    return () => {
      window.removeEventListener('focus', handleWindowFocus, true);
    };
  }, [showUploadPickerActive]);

  const replacePastedImage = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setPastedImage((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return { file, previewUrl };
    });
  };

  const clearPastedImage = () => {
    setPastedImage((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.previewUrl);
      }
      return null;
    });
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setText((prev) => prev + emoji);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);

    // Restore focus and set cursor position after emoji
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + emoji.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedChatId) {
        throw new Error(t('TurnInput.selectChatFirst'));
      }
      const content = text.trim();
      if (!content) {
        throw new Error(t('TurnInput.inputMessageRequired'));
      }
      await dataSync.sendMessage(selectedChatId, content);
      return content;
    },
    onSuccess: async () => {
      setText('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', selectedChatId] }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
    onError: (error) => {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('TurnInput.sendFailed'),
      });
    },
  });

  // File upload mutation
  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedChatId) {
        throw new Error(t('TurnInput.selectChatFirst'));
      }

      setIsUploading(true);
      try {
        // Determine file type
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');

        if (!isImage && !isVideo) {
          throw new Error(t('TurnInput.unsupportedFileType'));
        }

        // Get direct upload URL
        let uploadUrl: string;
        let mediaUid: string;

        if (isImage) {
          const uploadInfo = await dataSync.createImageDirectUpload();
          uploadUrl = uploadInfo.uploadUrl;
          mediaUid = uploadInfo.imageId;
        } else {
          const uploadInfo = await dataSync.createVideoDirectUpload();
          uploadUrl = uploadInfo.uploadURL;
          mediaUid = uploadInfo.uid;
        }

        if (!uploadUrl) {
          throw new Error(t('TurnInput.uploadFailed'));
        }

        // Upload file to the provided direct-upload endpoint.
        // Some providers expect multipart POST; others use raw PUT.
        const formData = new FormData();
        formData.append('file', file);
        let uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: file,
            headers: {
              'Content-Type': file.type,
            },
          });
        }

        if (!uploadResponse.ok) {
          throw new Error(t('TurnInput.uploadFailed'));
        }

        // Send message with media payload that realm chat validation expects.
        if (isImage) {
          const dimensions = await readImageDimensions(file);
          await dataSync.sendMessage(selectedChatId, '', {
            type: 'IMAGE' as MessageType,
            payload: {
              imageId: mediaUid,
              width: dimensions.width,
              height: dimensions.height,
            } as unknown as Record<string, never>,
          });
        } else {
          const metadata = await readVideoMetadata(file);
          await dataSync.sendMessage(selectedChatId, '', {
            type: 'VIDEO' as MessageType,
            payload: {
              videoId: mediaUid,
              width: metadata.width,
              height: metadata.height,
              duration: metadata.duration,
            } as unknown as Record<string, never>,
          });
        }

        return mediaUid;
      } finally {
        setIsUploading(false);
      }
    },
    onSuccess: async () => {
      clearPastedImage();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', selectedChatId] }),
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
    onError: (error) => {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('TurnInput.uploadFailed'),
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    setShowUploadPickerActive(false);
    const file = event.target.files?.[0];
    if (file) {
      uploadFileMutation.mutate(file);
    }
    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const handleUploadClick = () => {
    setShowUploadPickerActive(true);
    fileInputRef.current?.click();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }
    event.preventDefault();
    replacePastedImage(file);
  };

  const canSend = Boolean(selectedChatId)
    && !sendMutation.isPending
    && !isUploading
    && (Boolean(text.trim()) || Boolean(pastedImage));

  const handleSend = () => {
    if (!selectedChatId || sendMutation.isPending || isUploading) {
      return;
    }
    if (pastedImage) {
      uploadFileMutation.mutate(pastedImage.file);
      if (text.trim()) {
        sendMutation.mutate();
      }
      return;
    }
    if (text.trim()) {
      sendMutation.mutate();
    }
  };

  return (
    <section
      className={`${props.showTopBorder === false ? '' : 'border-t border-gray-100 '}relative flex h-full flex-col bg-white px-4 pb-4 pt-3 ${props.className || ''}`}
    >
      {/* Emoji Picker Popup */}
      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className="absolute bottom-full left-0 mb-2 ml-4 w-[320px] rounded-2xl bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)] border border-gray-100 overflow-hidden z-50"
        >
          {/* Emoji categories tabs with pagination */}
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
                  aria-label={emojiCategoryPage === 0 ? t('TurnInput.nextPage') : t('TurnInput.previousPage')}
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

      {/* Input container with border */}
      <div className="relative flex h-full flex-col rounded-2xl border border-gray-200 bg-gray-50/50 p-3">
        {pastedImage ? (
          <div className="mb-2 inline-block">
            <div className="relative inline-block">
              <img
                src={pastedImage.previewUrl}
                alt="Pasted image"
                className="block h-16 w-16 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={clearPastedImage}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white transition-colors hover:bg-black/80"
                aria-label={t('TurnInput.removeAttachment')}
                title={t('TurnInput.removeAttachment')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        {/* Input area */}
        <textarea
          ref={textareaRef}
          className="min-h-[44px] flex-1 w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-5 text-gray-900 outline-none placeholder:text-gray-400"
          rows={2}
          placeholder={t('TurnInput.typeMessage')}
          value={text}
          disabled={!selectedChatId || sendMutation.isPending}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) {
              return;
            }
            if (event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            event.preventDefault();
            handleSend();
          }}
        />

        {/* Toolbar row */}
        <div className="mt-2 mt-auto flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              ref={emojiButtonRef}
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                showEmojiPicker
                  ? 'bg-[#0066CC] text-white'
                  : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
              }`}
              aria-label={t('TurnInput.emoji')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </button>

            {/* File upload button */}
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={!selectedChatId || isUploading}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                showUploadPickerActive || isUploading || pastedImage
                  ? 'bg-[#0066CC] text-white'
                  : 'text-gray-500 hover:bg-gray-200/50 hover:text-gray-700'
              }`}
              aria-label={t('TurnInput.uploadFile')}
              title={t('TurnInput.uploadFile')}
            >
              {isUploading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
              aria-hidden="true"
            />

            {flags.enableModUi ? (
              <SlotHost slot="chat.turn.input.toolbar" base={null} context={context} />
            ) : null}
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`flex h-9 w-9 items-center justify-center rounded-full text-white shadow-sm transition-all hover:bg-[#0052A3] disabled:opacity-40 disabled:cursor-not-allowed ${
              isFocused && (text.trim() || pastedImage)
                ? 'bg-[#0066CC] shadow-[0_0_12px_rgba(0,102,204,0.5)] scale-105' 
                : 'bg-[#0066CC]/70'
            }`}
            aria-label={t('TurnInput.send')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
