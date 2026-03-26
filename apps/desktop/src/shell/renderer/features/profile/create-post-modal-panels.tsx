import { OverlayShell, ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type { Location } from './create-post-modal-helpers.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { i18n } from '@renderer/i18n';

export function EmojiPickerPanel(input: {
  show: boolean;
  position: { left: number; top: number } | null;
  categories: Array<{ name: string; emojis: string[]; originalIndex: number }>;
  activeEmojiCategory: number;
  totalCategoryPages: number;
  emojiCategoryPage: number;
  setActiveEmojiCategory: (index: number) => void;
  setEmojiPage: (page: number) => void;
  insertEmoji: (emoji: string) => void;
}) {
  const activeCategory = input.categories.find((category) => category.originalIndex === input.activeEmojiCategory)
    || input.categories[0]
    || { name: 'Default', emojis: [] as string[], originalIndex: 0 };

  if (!input.show || !input.position) {
    return null;
  }

  return (
    <OverlayShell
      open={input.show && Boolean(input.position)}
      kind="popover"
      closeOnBackdrop={false}
      dataTestId={E2E_IDS.createPostEmojiPanel}
      className="pointer-events-none bg-transparent p-0 backdrop-blur-0"
      panelClassName="emoji-panel pointer-events-auto fixed max-w-none w-[320px] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)]"
      panelStyle={{ left: input.position.left, top: input.position.top }}
      contentClassName="p-0"
    >
      <div className="relative border-b border-gray-100">
        <div className="flex items-center gap-1 px-2 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {input.categories.map((category) => (
              <button
                key={category.name}
                type="button"
                onClick={() => input.setActiveEmojiCategory(category.originalIndex)}
                className={`flex-shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  input.activeEmojiCategory === category.originalIndex
                    ? 'bg-[#0066CC] text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
          {input.totalCategoryPages > 1 ? (
            <button
              type="button"
              onClick={() => input.setEmojiPage(input.emojiCategoryPage === 0 ? input.emojiCategoryPage + 1 : input.emojiCategoryPage - 1)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label={input.emojiCategoryPage === 0
                ? i18n.t('ChatTimeline.nextPage', { defaultValue: 'Next page' })
                : i18n.t('ChatTimeline.previousPage', { defaultValue: 'Previous page' })}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {input.emojiCategoryPage === 0 ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      <ScrollArea className="max-h-[260px]" viewportClassName="max-h-[260px]" contentClassName="p-3">
        <div className="grid grid-cols-8 gap-1">
          {activeCategory.emojis.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              onClick={() => input.insertEmoji(emoji)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xl transition-colors hover:bg-gray-100"
            >
              {emoji}
            </button>
          ))}
        </div>
      </ScrollArea>
    </OverlayShell>
  );
}

export function LocationPickerPanel(input: {
  show: boolean;
  position: { left: number; top: number } | null;
  loadingLocations: boolean;
  locationSearch: string;
  setLocationSearch: (value: string) => void;
  filteredLocations: Location[];
  availableLocations: Location[];
  selectedLocation: Location | null;
  selectLocation: (location: Location) => void;
}) {
  if (!input.show || !input.position) {
    return null;
  }

  return (
    <OverlayShell
      open={input.show && Boolean(input.position)}
      kind="popover"
      closeOnBackdrop={false}
      dataTestId={E2E_IDS.createPostLocationPanel}
      className="pointer-events-none bg-transparent p-0 backdrop-blur-0"
      panelClassName="location-panel pointer-events-auto fixed max-w-none w-[320px] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)]"
      panelStyle={{ left: input.position.left, top: input.position.top }}
      contentClassName="p-0"
    >
      <div className="border-b border-gray-100 p-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={i18n.t('Profile.CreatePost.searchLocationPlaceholder', { defaultValue: 'Search location...' })}
            value={input.locationSearch}
            onChange={(event) => input.setLocationSearch(event.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-[#4ECCA3] focus:outline-none focus:ring-1 focus:ring-[#4ECCA3]"
          />
        </div>
      </div>
      <ScrollArea className="max-h-48" viewportClassName="max-h-48" contentClassName="py-2">
        {input.loadingLocations ? (
          <div className="px-3 py-4 text-center text-sm text-gray-500">
            {i18n.t('Profile.CreatePost.loadingLocations', { defaultValue: 'Loading locations...' })}
          </div>
        ) : input.filteredLocations.length > 0 ? (
          input.filteredLocations.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => input.selectLocation(location)}
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
              {input.selectedLocation?.id === location.id ? (
                <svg className="mt-1 h-4 w-4 text-[#4ECCA3]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
            </button>
          ))
        ) : (
          <div className="px-3 py-4 text-center text-sm text-gray-500">
            {input.availableLocations.length > 0
              ? i18n.t('Profile.CreatePost.noLocationsFound', { defaultValue: 'No locations found' })
              : i18n.t('Profile.CreatePost.noWorldsAvailable', { defaultValue: 'No worlds available' })}
          </div>
        )}
      </ScrollArea>
    </OverlayShell>
  );
}

export function TagPickerPanel(input: {
  show: boolean;
  position: { left: number; top: number } | null;
  tagSearch: string;
  setTagSearch: (value: string) => void;
  filteredTags: string[];
  tags: string[];
  insertTag: (tag: string) => void;
}) {
  if (!input.show || !input.position) {
    return null;
  }

  return (
    <OverlayShell
      open={input.show && Boolean(input.position)}
      kind="popover"
      closeOnBackdrop={false}
      dataTestId={E2E_IDS.createPostTagPanel}
      className="pointer-events-none bg-transparent p-0 backdrop-blur-0"
      panelClassName="tag-panel pointer-events-auto fixed max-w-none w-[280px] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)]"
      panelStyle={{ left: input.position.left, top: input.position.top }}
      contentClassName="p-0"
    >
      <div className="border-b border-gray-100 p-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={i18n.t('Profile.CreatePost.searchOrCreateTagPlaceholder', { defaultValue: 'Search or create a tag...' })}
            value={input.tagSearch}
            onChange={(event) => input.setTagSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && input.tagSearch.trim()) {
                input.insertTag(input.tagSearch.trim());
              }
            }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-[#4ECCA3] focus:outline-none focus:ring-1 focus:ring-[#4ECCA3]"
          />
        </div>
      </div>
      <ScrollArea className="max-h-48" viewportClassName="max-h-48" contentClassName="py-2">
        {input.filteredTags.length > 0 ? (
          <div className="mb-1">
            {input.filteredTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => input.insertTag(tag)}
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
                {input.tags.includes(tag) ? (
                  <svg className="h-4 w-4 text-[#4ECCA3]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {input.tagSearch.trim() && !input.tags.includes(input.tagSearch.trim()) ? (
          <button
            type="button"
            onClick={() => input.insertTag(input.tagSearch.trim())}
            className="flex w-full items-center gap-3 border-t border-gray-100 px-3 py-2.5 transition hover:bg-[#4ECCA3]/10"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4ECCA3]/10 text-[#4ECCA3]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-[#4ECCA3]">
                {i18n.t('Profile.CreatePost.createTag', {
                  tag: input.tagSearch.trim(),
                  defaultValue: 'Create tag "{{tag}}"',
                })}
              </p>
            </div>
          </button>
        ) : null}

        {!input.tagSearch.trim() && input.filteredTags.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-500">
            {i18n.t('Profile.CreatePost.typeToSearchOrCreateTag', { defaultValue: 'Type to search or create a new tag' })}
          </div>
        ) : null}
      </ScrollArea>
    </OverlayShell>
  );
}
