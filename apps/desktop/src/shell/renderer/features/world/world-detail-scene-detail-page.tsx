import { useTranslation } from 'react-i18next';
import {
  PAPER,
  PAPER_RADIUS,
  PAPER_SERIF,
} from './world-detail-paper-model.js';
import { worldDetailPaperContentFrameStyle } from './world-detail-layout.js';
import {
  IconChevron,
  PaperAvatar,
} from './world-detail-paper-primitives.js';
import { detailSceneBackground } from './world-detail-template-model.js';
import type { WorldAssetExternalRef, WorldSceneItem } from './world-detail-types.js';

export function WorldSceneDetailPage({
  onBack,
  onSelectCharacter,
  scene,
  sceneImageRef,
}: {
  isOasisWorld: boolean;
  oasisSceneActionLabel: string;
  onBack: () => void;
  onSelectCharacter: (characterId: string) => void;
  onViewCharacters: () => void;
  onViewEvents?: () => void;
  scene: WorldSceneItem;
  sceneImageRef?: WorldAssetExternalRef | null;
}) {
  const { t } = useTranslation();
  const activeEntities = scene.activeEntities.slice(0, 8);
  const relatedCharacters = scene.relatedCharacters;
  const relatedEvents = scene.relatedEvents;
  const relatedResources = scene.relatedResources;

  return (
    <div
      data-testid="world-detail-scene-detail-page"
      style={{ position: 'relative', minHeight: '100%', fontFamily: 'var(--nimi-font-sans)' }}
    >
      <div style={worldDetailPaperContentFrameStyle()}>
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 14, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: PAPER.green, border: `1px solid ${PAPER.borderSoft}`, borderRadius: 999, background: PAPER.card, padding: '8px 13px', cursor: 'pointer', boxShadow: PAPER.cardShadow }}
        >
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
            <IconChevron size={13} color={PAPER.green} />
          </span>
          {t('WorldDetail.paper.gallery.backToWorld')}
        </button>

        <section
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            overflow: 'hidden',
            borderRadius: PAPER_RADIUS.xl,
            border: `1px solid ${PAPER.border}`,
            background: PAPER.card,
            boxShadow: PAPER.cardShadowStrong,
          }}
        >
          <>
            <div style={{ position: 'relative', minHeight: 246, background: sceneImageRef ? detailSceneBackground(sceneImageRef.uri) : 'linear-gradient(135deg,#e9e0cb,#d8ccae)' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(28,24,18,.03),rgba(28,24,18,.66))' }} />
              <div style={{ position: 'absolute', left: 24, right: 24, bottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#e9f4e8', fontSize: 13, fontWeight: 900 }}>
                  <span style={{ width: 4, height: 19, borderRadius: 6, background: '#e9f4e8' }} />
                  {t('WorldDetail.paper.scenes.detailCard')}
                </div>
                <h2 style={{ margin: '10px 0 0', maxWidth: 760, fontFamily: PAPER_SERIF, fontSize: 34, lineHeight: 1.12, fontWeight: 900, color: '#fffaf0' }}>
                  {scene.name}
                </h2>
              </div>
            </div>

            <div style={{ padding: '22px 24px 24px' }}>
              <p style={{ margin: '0 0 18px', maxWidth: 760, fontSize: 14, lineHeight: 1.75, color: PAPER.muted }}>
                {scene.description || t('WorldDetail.xianxia.v2.scenes.noDescription')}
              </p>

              <div style={{ display: 'grid', gap: 18 }}>
                {activeEntities.length > 0 ? (
                <section>
                  <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.activeEntities')}</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {activeEntities.map((entity) => {
                      const label = entity.label || entity.id;
                      const character = relatedCharacters.find((item) => item.id === entity.id || item.name === label) ?? null;
                      return (
                        <button
                          key={`${scene.id}-active-${entity.id}`}
                          type="button"
                          onClick={() => {
                            if (character) {
                              onSelectCharacter(character.id);
                            }
                          }}
                          disabled={!character}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            minHeight: 30,
                            border: `1px solid ${PAPER.borderSoft}`,
                            borderRadius: 999,
                            background: PAPER.greenSoftBg,
                            color: PAPER.green,
                            padding: '6px 11px',
                            fontSize: 12.5,
                            fontWeight: 900,
                            cursor: character ? 'pointer' : 'default',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </section>
                ) : null}

                {relatedCharacters.length > 0 ? (
                <section>
                  <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.relatedCharacters')}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
                    {relatedCharacters.map((character) => (
                      <button
                        key={`${scene.id}-character-${character.id}`}
                        type="button"
                        onClick={() => onSelectCharacter(character.id)}
                        style={{ display: 'grid', gridTemplateColumns: '34px 1fr', alignItems: 'center', gap: 9, minWidth: 0, minHeight: 52, border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, background: 'rgba(255,253,248,.68)', padding: 9, textAlign: 'left', cursor: 'pointer' }}
                      >
                        <PaperAvatar name={character.name} imageUrl={character.avatarUrl} size={34} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 900, color: PAPER.inkStrong, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{character.name}</span>
                          <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: PAPER.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{character.role || character.faction || character.handle}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
                ) : null}

                {relatedEvents.length > 0 ? (
                <section>
                  <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.relatedEvents')}</h3>
                  <div style={{ display: 'grid', gap: 9 }}>
                    {relatedEvents.map((event, index) => (
                      <div key={`${scene.id}-event-${event.id}`} style={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 10, alignItems: 'start', border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, padding: 10, background: 'rgba(255,253,248,.62)' }}>
                        <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, background: index === 0 ? '#bd8138' : index === 1 ? '#6f8795' : '#b36b5f', color: '#fffaf0', fontSize: 12, fontWeight: 900 }}>{index + 1}</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 900, color: PAPER.inkStrong }}>{event.title}</span>
                          <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: PAPER.muted, lineHeight: 1.5 }}>{event.summary || event.description}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
                ) : null}

                {relatedResources.length > 0 ? (
                <section>
                  <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.relatedResources')}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9 }}>
                    {relatedResources.map((resource) => (
                      <div key={`${scene.id}-resource-${resource.id}`} style={{ border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, padding: 10, background: 'rgba(255,253,248,.62)', minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 11, fontWeight: 900, color: PAPER.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resource.kind}</span>
                        <span style={{ display: 'block', marginTop: 4, fontSize: 13, fontWeight: 900, color: PAPER.inkStrong, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resource.title}</span>
                        {resource.summary ? (
                          <span style={{ display: 'block', marginTop: 4, fontSize: 12, lineHeight: 1.5, color: PAPER.muted }}>{resource.summary}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
                ) : null}
              </div>
            </div>
          </>
        </section>
      </div>
    </div>
  );
}
