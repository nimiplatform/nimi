import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

type PanelPosition = { left: number; top: number } | null;

function readPanelPosition(ref: RefObject<HTMLButtonElement | null>): PanelPosition {
  if (!ref.current) {
    return null;
  }
  const rect = ref.current.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + 8 };
}

export function useCreatePostModalPanelState(input: {
  open: boolean;
  emojiButtonRef: RefObject<HTMLButtonElement | null>;
  locationButtonRef: RefObject<HTMLButtonElement | null>;
  tagButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [showLocationPanel, setShowLocationPanel] = useState(false);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [emojiPanelPos, setEmojiPanelPos] = useState<PanelPosition>(null);
  const [locationPanelPos, setLocationPanelPos] = useState<PanelPosition>(null);
  const [tagPanelPos, setTagPanelPos] = useState<PanelPosition>(null);

  const closeAllPanels = () => {
    setShowEmojiPanel(false);
    setShowLocationPanel(false);
    setShowTagPanel(false);
  };

  const toggleEmojiPanel = () => {
    const nextValue = !showEmojiPanel;
    setShowEmojiPanel(nextValue);
    setShowLocationPanel(false);
    setShowTagPanel(false);
    if (nextValue) {
      setEmojiPanelPos(readPanelPosition(input.emojiButtonRef));
    }
  };

  const toggleLocationPanel = () => {
    const nextValue = !showLocationPanel;
    setShowLocationPanel(nextValue);
    setShowEmojiPanel(false);
    setShowTagPanel(false);
    if (nextValue) {
      setLocationPanelPos(readPanelPosition(input.locationButtonRef));
    }
  };

  const toggleTagPanel = () => {
    const nextValue = !showTagPanel;
    setShowTagPanel(nextValue);
    setShowEmojiPanel(false);
    setShowLocationPanel(false);
    if (nextValue) {
      setTagPanelPos(readPanelPosition(input.tagButtonRef));
    }
  };

  useEffect(() => {
    if (!input.open) {
      closeAllPanels();
      return;
    }
    if (!showEmojiPanel && !showLocationPanel && !showTagPanel) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
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
  }, [input.open, showEmojiPanel, showLocationPanel, showTagPanel]);

  useEffect(() => {
    if (!input.open) {
      return;
    }

    const handleResize = () => {
      if (showEmojiPanel) {
        setEmojiPanelPos(readPanelPosition(input.emojiButtonRef));
      }
      if (showLocationPanel) {
        setLocationPanelPos(readPanelPosition(input.locationButtonRef));
      }
      if (showTagPanel) {
        setTagPanelPos(readPanelPosition(input.tagButtonRef));
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [input.open, input.emojiButtonRef, input.locationButtonRef, input.tagButtonRef, showEmojiPanel, showLocationPanel, showTagPanel]);

  return {
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
  };
}
