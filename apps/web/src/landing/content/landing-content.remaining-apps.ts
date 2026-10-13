import type { PreviewTranslate } from '../i18n/preview-messages.js';
/** Static introductions to the remaining checked-out Apps; no live account or model data. */
export type RemainingPreviewMeta = {
  id: string;
  name: string;
  icon: string;
  notice: string;
};

export const createRemainingAppPreviewContent = (t: PreviewTranslate) =>
  ({
    inscape: {
      id: 'nimi.inscape',
      name: t('inscape.preview.name'),
      icon: '/demo/inscape-icon.png',
      notice: t('inscape.preview.notice'),
    },
    overtone: {
      id: 'nimi.overtone',
      name: 'Nimi Overtone',
      icon: '/demo/overtone-icon.png',
      notice: t('overtone.preview.notice'),
    },
    polyagent: {
      id: 'nimi.polyagent',
      name: 'PolyAgent',
      icon: '/demo/polyagent-icon.png',
      notice: t('polyagent.preview.notice'),
    },
    persona: {
      id: 'nimi.realm-persona-studio',
      name: 'Realm Persona Studio',
      icon: '/demo/persona-studio-icon.png',
      notice: t('realmPersona.preview.notice'),
    },
    world: {
      id: 'nimi.realm-world-studio',
      name: 'Realm World Studio',
      icon: '/demo/world-studio-icon.png',
      notice: t('realmWorld.preview.notice'),
    },
    deeptutor: {
      id: 'org.nimiplatform.deeptutor',
      name: 'DeepTutor',
      icon: '/demo/deeptutor-icon.png',
      notice: t('deeptutor.preview.notice'),
    },
    openmontage: {
      id: 'openmontage.studio',
      name: 'OpenMontage',
      icon: '/demo/openmontage-icon.png',
      notice: t('openmontage.preview.notice'),
    },
    sillytavern: {
      id: 'org.nimiplatform.sillytavern',
      name: 'SillyTavern',
      icon: '/demo/sillytavern-icon.png',
      notice: t('sillytavern.preview.notice'),
    },
    vane: {
      id: 'nimiplatform.vane',
      name: 'Vane',
      icon: '/demo/vane-icon.png',
      notice: t('vane.preview.notice'),
    },
    drawio: {
      id: 'io.github.nimiplatform.next-ai-draw-io',
      name: 'Next AI Draw.io',
      icon: '/demo/drawio-icon.png',
      notice: t('drawio.preview.notice'),
    },
    notebook: {
      id: 'io.github.nimiplatform.open-notebook',
      name: 'Open Notebook',
      icon: '/demo/open-notebook-icon.png',
      notice: t('openNotebook.preview.notice'),
    },
    presenton: {
      id: 'io.github.nimiplatform.presenton',
      name: 'Presenton',
      icon: '/demo/presenton-icon.png',
      notice: t('presenton.preview.notice'),
    },
  }) satisfies Record<string, RemainingPreviewMeta>;

export type RemainingAppPreviewContent = ReturnType<typeof createRemainingAppPreviewContent>;
