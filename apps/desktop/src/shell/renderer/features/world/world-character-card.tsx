import { useTranslation } from 'react-i18next';
import { Avatar, Button, NimiText, Surface } from '@nimiplatform/kit/ui';
import { ArrowUpRight } from 'lucide-react';
import type { WorldCharacter } from './world-detail-types.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r005
export function WorldCharacterCard({ character, onView }: { character: WorldCharacter; onView: (character: WorldCharacter) => void }) {
  const { t } = useTranslation();
  const image = character.portraitUrl || character.mediaAssets?.portrait?.url || character.avatarUrl || character.mediaAssets?.avatar?.url;
  const tags = [...new Set(character.traits?.map((trait) => trait.trim()).filter((trait) => trait.length > 0 && trait.length <= 24))].slice(0, 2);
  return (
    <Surface as="article" tone="card" padding="none" className="flex min-w-0 gap-4 overflow-hidden p-4 shadow-none @min-[1120px]:flex-col" data-testid="world-character-card">
      <Avatar src={image} alt={character.name} shape="rounded" size="lg" className="h-28 w-28 bg-[var(--nimi-surface-panel)] @min-[1120px]:h-44 @min-[1120px]:w-full [&_img]:object-[50%_30%]" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <NimiText role="card-title" className="line-clamp-2 break-words text-[length:var(--nimi-type-section-title-size)]" title={character.name}>{character.name}</NimiText>
        {character.role?.trim() ? <NimiText role="label" className="line-clamp-2 break-words text-[var(--nimi-action-primary-bg)]" title={character.role}>{character.role}</NimiText> : null}
        {character.bio?.trim() ? <NimiText role="helper" className="line-clamp-2 break-words">{character.bio}</NimiText> : null}
        {tags.length ? <div className="flex max-w-full gap-2 overflow-hidden">{tags.map((tag) => <NimiText key={tag} role="caption" className="truncate rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] px-2 py-1" title={tag}>{tag}</NimiText>)}</div> : null}
        <Button tone="secondary" size="sm" className="mt-auto" trailingIcon={<ArrowUpRight size={14} />} onClick={() => onView(character)} aria-label={t('WorldDetail.discovery.viewNamedCharacter', { name: character.name })}>
          {t('WorldDetail.discovery.viewCharacter')}
        </Button>
      </div>
    </Surface>
  );
}
