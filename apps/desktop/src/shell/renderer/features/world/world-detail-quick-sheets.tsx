import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { joinParts } from './world-detail-primitives.js';
import type { WorldCharacter, WorldHistoryItem, WorldSceneItem } from './world-detail-types.js';

export function WorldCharacterQuickSheet({
  character,
  onClose,
  onViewCharacter,
}: {
  character: WorldCharacter;
  onClose: () => void;
  onViewCharacter?: (character: WorldCharacter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-5 py-6">
      <button
        type="button"
        className="absolute inset-0"
        aria-label={t('WorldDetail.xianxia.v2.characters.quickSheetClose')}
        onClick={onClose}
      />
      <div className="relative flex items-center justify-center">
        <section className="relative z-10 w-full max-w-[620px] max-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] border border-[#4ECCA3]/20 bg-[#0d1511]/96 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
          <ScrollArea className="max-h-[calc(100vh-3rem-2px)]" viewportClassName="px-6 pb-6 pt-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#86f0ca]/76">
                  {t('WorldDetail.xianxia.v2.characters.quickSheetTitle')}
                </div>
                <h3 className="mt-2 text-2xl font-semibold text-[#effff8]">{character.name}</h3>
                <div className="mt-1 text-sm text-[#86f0ca]">{character.handle}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-3 py-1.5 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
              >
                {t('WorldDetail.xianxia.v2.characters.quickSheetClose')}
              </button>
            </div>

            <div className="grid gap-5 md:grid-cols-[120px_minmax(0,1fr)]">
              <div className="flex justify-center md:justify-start">
                <EntityAvatar
                  imageUrl={character.avatarUrl}
                  name={character.name}
                  kind="source"
                  sizeClassName="h-28 w-28"
                  radiusClassName="rounded-[20px]"
                  innerRadiusClassName="rounded-[16px]"
                  textClassName="text-3xl font-serif"
                />
              </div>

              <div className="grid gap-3">
                {joinParts([character.role, character.faction, character.rank]) ? (
                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.characters.quickSheetIdentity')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#effff8]">
                      {joinParts([character.role, character.faction, character.rank])}
                    </div>
                  </div>
                ) : null}

                {joinParts([character.sceneName, character.location]) ? (
                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.characters.quickSheetLocation')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#effff8]">
                      {joinParts([character.sceneName, character.location])}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                    {t('WorldDetail.xianxia.v2.characters.quickSheetBio')}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/72">
                    {character.bio || t('WorldDetail.noDescription')}
                  </div>
                </div>

                {character.stats?.vitalityScore != null ? (
                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-black/16 px-4 py-3 text-sm text-[#d8efe4]/72">
                    {t('WorldDetail.xianxia.v2.characters.vitality')} {character.stats.vitalityScore}
                  </div>
                ) : null}
              </div>
            </div>

            {onViewCharacter ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onViewCharacter(character)}
                  className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                >
                  {t('WorldDetail.xianxia.v2.characters.quickSheetViewProfile')}
                </button>
              </div>
            ) : null}
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}

export function WorldSceneQuickSheet({
  isOasisWorld,
  oasisSceneActionLabel,
  onClose,
  onSelectCharacter,
  onViewCharacters,
  onViewEvents,
  relatedCharacters,
  relatedEvents,
  scene,
}: {
  isOasisWorld: boolean;
  oasisSceneActionLabel: string;
  onClose: () => void;
  onSelectCharacter: (characterId: string) => void;
  onViewCharacters: () => void;
  onViewEvents: () => void;
  relatedCharacters: readonly WorldCharacter[];
  relatedEvents: readonly WorldHistoryItem[];
  scene: WorldSceneItem;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 bg-black/55 px-5 py-6">
      <button
        type="button"
        className="absolute inset-0"
        aria-label={t('WorldDetail.xianxia.v2.scenes.quickSheetClose')}
        onClick={onClose}
      />
      <div className="relative flex min-h-full items-start justify-center sm:items-center">
        <section className="relative z-10 w-full max-w-[760px] max-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] border border-[#4ECCA3]/20 bg-[#0d1511]/96 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
          <ScrollArea className="max-h-[calc(100vh-3rem-2px)]" viewportClassName="px-6 pb-6 pt-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-[#86f0ca]/76">
                  {t('WorldDetail.xianxia.v2.scenes.quickSheetTitle')}
                </div>
                <h3 className="mt-2 text-2xl font-semibold text-[#effff8]">{scene.name}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-3 py-1.5 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
              >
                {t('WorldDetail.xianxia.v2.scenes.quickSheetClose')}
              </button>
            </div>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                  {t('WorldDetail.xianxia.v2.scenes.quickSheetDescription')}
                </div>
                <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/72">
                  {scene.description || t('WorldDetail.xianxia.v2.scenes.noDescription')}
                </div>
              </div>

              {scene.activeEntities.length ? (
                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetActiveEntities')}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {scene.activeEntities.map((entity) => {
                      const character = relatedCharacters.find((item) => item.name === entity) || null;
                      return (
                        <button
                          key={`${scene.id}-${entity}`}
                          type="button"
                          onClick={() => {
                            if (character) {
                              onSelectCharacter(character.id);
                            }
                          }}
                          className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2]"
                        >
                          {entity}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {relatedCharacters.length ? (
                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetViewCharacters')}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {relatedCharacters.map((character) => (
                      <button
                        key={`${scene.id}-related-${character.id}`}
                        type="button"
                        onClick={() => onSelectCharacter(character.id)}
                        className="rounded-full border border-[#4ECCA3]/16 bg-black/16 px-3 py-1 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/12"
                      >
                        {character.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {relatedEvents.length ? (
                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetRelatedEvents')}
                  </div>
                  <div className="mt-3 grid gap-2">
                    {relatedEvents.map((event) => (
                      <div key={event.id} className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                        <div className="text-sm font-semibold text-[#effff8]">{event.title}</div>
                        <div className="mt-1 text-sm text-[#d8efe4]/66">{event.summary || event.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isOasisWorld}
                className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] opacity-70"
              >
                {oasisSceneActionLabel}
              </button>
              {isOasisWorld ? (
                <span className="inline-flex items-center rounded-full border border-[#4ECCA3]/12 bg-black/16 px-3 py-1 text-[11px] text-[#86f0ca]/78">
                  {t('WorldDetail.xianxia.v2.scenes.comingSoon')}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onViewCharacters}
                className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
              >
                {t('WorldDetail.xianxia.v2.scenes.quickSheetViewCharacters')}
              </button>
              <button
                type="button"
                onClick={onViewEvents}
                className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
              >
                {t('WorldDetail.xianxia.v2.scenes.quickSheetViewEvents')}
              </button>
            </div>
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}
