import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import {
  PAPER,
  PAPER_RADIUS,
  PAPER_SERIF,
  formatNum,
} from './world-detail-paper-model.js';
import {
  IconArrow,
  IconChevron,
  PaperAvatar,
  PaperTag,
  paperGhostButton,
  paperPrimaryButton,
} from './world-detail-paper-primitives.js';
import { detailSceneBackground } from './world-detail-template-model.js';
import type { WorldAssetExternalRef, WorldCharacter, WorldHistoryItem, WorldSceneItem } from './world-detail-types.js';

export function WorldSceneDetailPage({
  isOasisWorld,
  oasisSceneActionLabel,
  onBack,
  onSelectCharacter,
  onViewCharacters,
  onViewEvents,
  relatedCharacters,
  relatedEvents,
  scene,
  sceneImageRef,
}: {
  isOasisWorld: boolean;
  oasisSceneActionLabel: string;
  onBack: () => void;
  onSelectCharacter: (characterId: string) => void;
  onViewCharacters: () => void;
  onViewEvents: () => void;
  relatedCharacters: readonly WorldCharacter[];
  relatedEvents: readonly WorldHistoryItem[];
  scene: WorldSceneItem;
  sceneImageRef?: WorldAssetExternalRef | null;
}) {
  const { t } = useTranslation();
  const activeEntities = scene.activeEntities.slice(0, 8);
  const imageLabel = sceneImageRef?.refId ?? t('WorldDetail.paper.scenes.noImage');

  return (
    <div
      data-testid="world-detail-scene-detail-page"
      style={{ position: 'relative', minHeight: '100%', fontFamily: 'var(--nimi-font-sans)' }}
    >
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1180, margin: '0 auto', padding: '22px 28px 80px' }}>
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
          <ScrollArea className="max-h-[calc(100vh-154px)]" viewportClassName="pb-0">
            <div style={{ position: 'relative', minHeight: 246, background: sceneImageRef ? detailSceneBackground(sceneImageRef.uri) : 'linear-gradient(135deg,#e9e0cb,#d8ccae)' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(28,24,18,.03),rgba(28,24,18,.66))' }} />
              <div style={{ position: 'absolute', left: 24, right: 24, top: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 30, maxWidth: '100%', borderRadius: 999, padding: '6px 11px', color: '#fffaf0', fontSize: 12, fontWeight: 900, background: 'rgba(38,32,23,.56)', border: '1px solid rgba(255,250,240,.24)', backdropFilter: 'blur(10px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t('WorldDetail.paper.scenes.image')} · {imageLabel}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 30, borderRadius: 999, padding: '6px 11px', color: '#fffaf0', fontSize: 12, fontWeight: 900, background: 'rgba(38,32,23,.56)', border: '1px solid rgba(255,250,240,.24)', backdropFilter: 'blur(10px)' }}>
                  {t('WorldDetail.paper.scenes.public')}
                </span>
              </div>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, maxWidth: 760, fontSize: 14, lineHeight: 1.75, color: PAPER.muted }}>
                  {scene.description || t('WorldDetail.xianxia.v2.scenes.noDescription')}
                </p>
                <PaperTag>{t('WorldDetail.paper.scenes.sceneResolved')}</PaperTag>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 }}>
                {[
                  { value: activeEntities.length, label: t('WorldDetail.paper.scenes.activeEntities') },
                  { value: relatedCharacters.length, label: t('WorldDetail.paper.scenes.relatedCharacters') },
                  { value: relatedEvents.length, label: t('WorldDetail.paper.scenes.relatedEvents') },
                ].map((metric) => (
                  <div key={metric.label} style={{ border: `1px solid ${PAPER.borderSoft}`, borderRadius: PAPER_RADIUS.md, padding: '13px 14px', background: 'rgba(255,253,248,.72)', minWidth: 0 }}>
                    <div style={{ fontFamily: PAPER_SERIF, fontSize: 24, lineHeight: 1, fontWeight: 800, color: PAPER.inkStrong }}>{formatNum(metric.value)}</div>
                    <div style={{ marginTop: 7, fontSize: 12, color: PAPER.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gap: 18 }}>
                <section>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.activeEntities')}</h3>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: PAPER.faint }}>{t('WorldDetail.paper.scenes.fromEntityRefs')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minHeight: 30 }}>
                    {activeEntities.length > 0 ? activeEntities.map((entity) => {
                      const character = relatedCharacters.find((item) => item.name === entity) ?? null;
                      return (
                        <button
                          key={`${scene.id}-active-${entity}`}
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
                          {entity}
                        </button>
                      );
                    }) : (
                      <span style={{ color: PAPER.faint, fontSize: 13 }}>{t('WorldDetail.paper.scenes.none')}</span>
                    )}
                  </div>
                </section>

                <section>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.relatedCharacters')}</h3>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: PAPER.faint }}>{t('WorldDetail.paper.scenes.fromCharacters')}</span>
                  </div>
                  {relatedCharacters.length > 0 ? (
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
                  ) : (
                    <span style={{ color: PAPER.faint, fontSize: 13 }}>{t('WorldDetail.paper.scenes.none')}</span>
                  )}
                </section>

                <section>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.relatedEvents')}</h3>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: PAPER.faint }}>{t('WorldDetail.paper.scenes.fromEvents')}</span>
                  </div>
                  {relatedEvents.length > 0 ? (
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
                  ) : (
                    <span style={{ color: PAPER.faint, fontSize: 13 }}>{t('WorldDetail.paper.scenes.none')}</span>
                  )}
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
                  {[
                    { label: t('WorldDetail.paper.scenes.sceneId'), value: scene.id },
                    { label: t('WorldDetail.paper.scenes.imageAssetRef'), value: imageLabel },
                  ].map((item) => (
                    <div key={item.label} style={{ borderRadius: PAPER_RADIUS.md, border: `1px solid ${PAPER.borderSoft}`, background: 'rgba(248,242,231,.68)', padding: '10px 11px', minWidth: 0 }}>
                      <span style={{ display: 'block', color: PAPER.faint, fontSize: 11, marginBottom: 5 }}>{item.label}</span>
                      <code style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: PAPER.ink, fontFamily: 'var(--nimi-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 12 }}>{item.value}</code>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: `1px solid ${PAPER.borderInner}`, margin: '20px -24px -24px', padding: '14px 24px', background: 'rgba(246,238,222,.62)', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 220, flex: '1 1 260px' }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: PAPER.inkStrong }}>{t('WorldDetail.paper.scenes.enterHintTitle')}</div>
                  <div style={{ marginTop: 3, color: PAPER.faint, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('WorldDetail.paper.scenes.enterHintDesc')}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button type="button" disabled={isOasisWorld} style={{ ...paperPrimaryButton, opacity: isOasisWorld ? 0.55 : 1, cursor: isOasisWorld ? 'default' : 'pointer' }}>
                    {oasisSceneActionLabel}
                    <IconArrow size={13} color="#f6f2e7" />
                  </button>
                  {isOasisWorld ? (
                    <span style={{ ...paperGhostButton, cursor: 'default' }}>{t('WorldDetail.xianxia.v2.scenes.comingSoon')}</span>
                  ) : null}
                  <button type="button" onClick={onViewCharacters} style={paperGhostButton}>
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetViewCharacters')}
                  </button>
                  <button type="button" onClick={onViewEvents} style={paperGhostButton}>
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetViewEvents')}
                  </button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}
