import type { DemoDestination, PreviewDestination, PreviewScreen } from './demo-navigation.js';

export const COURTYARD_PARTNER = 'demo:emberware-court:character-0';
export const EXAMPLE_LOG = 'ai:log-example';

type Stop = { destination: DemoDestination; anchor: string; preview?: PreviewDestination };
type Chapter = { id: string; copy: 'worlds' | 'capabilities' | 'riskControl' | 'create' | 'continuity' | 'developers'; manual?: boolean; embeddedApps?: boolean; stops: readonly [Stop, ...Stop[]] };

function appStop(appId: string, screen: PreviewScreen, anchor: string): Stop {
  return { destination: { surface: 'apps', target: appId }, preview: { appId, screen }, anchor };
}

export const demoChapters: readonly Chapter[] = [
  { id: 'worlds', copy: 'worlds', stops: [
    { destination: { surface: 'explore' }, anchor: 'world-gallery' },
    { destination: { surface: 'explore', target: 'characters' }, anchor: 'character-gallery' },
    { destination: { surface: 'explore', target: 'world:emberware-court' }, anchor: 'world' },
    { destination: { surface: 'explore', target: 'character:' + COURTYARD_PARTNER }, anchor: 'character' },
    { destination: { surface: 'explore', target: 'partner:' + COURTYARD_PARTNER }, anchor: 'local-partner' },
    { destination: { surface: 'chat', target: COURTYARD_PARTNER }, anchor: 'transcript' },
  ] },
  { id: 'models', copy: 'capabilities', stops: [
    { destination: { surface: 'runtime' }, anchor: 'ready' },
    { destination: { surface: 'runtime', target: 'text.generate' }, anchor: 'model' },
    { destination: { surface: 'cloud' }, anchor: 'cloud-add' },
    { destination: { surface: 'cloud', target: 'catalog' }, anchor: 'cloud-catalog' },
  ] },
  // @nimi-authority: rule.nimi.runtime.ai-provider.text-content-boundaries
  // @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
  // @nimi-authority: rule.nimi.runtime.protected-session.r010
  { id: 'risk-control', copy: 'riskControl', manual: true, stops: [
    { destination: { surface: 'apps', target: 'nimi.parentos', view: 'access' }, anchor: 'access' },
    { destination: { surface: 'cloud', target: 'credentials' }, anchor: 'cloud-custody' },
    { destination: { surface: 'chat', target: EXAMPLE_LOG, view: 'draft' }, anchor: 'composer' },
  ] },
  { id: 'create', copy: 'create', manual: true, embeddedApps: true, stops: [
    appStop('nimi.parentos', 'home', 'app-content'),
    appStop('ai.nimi.videolingo', 'home', 'app-content'),
    appStop('io.github.nimiplatform.next-ai-draw-io', 'home', 'app-content'),
  ] },
  { id: 'continuity', copy: 'continuity', manual: true, embeddedApps: true, stops: [
    appStop('nimi.zhiyu', 'companion', 'partner-chat'),
    appStop('nimi.zhiyu', 'memory', 'memory'),
    { destination: { surface: 'chat', target: COURTYARD_PARTNER }, anchor: 'transcript' },
    appStop('nimi.zhiyu', 'companion', 'partner-chat'),
  ] },
  // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042d
  { id: 'developers', copy: 'developers', stops: [
    { destination: { surface: 'settings', target: 'developer' }, anchor: 'developer' },
    { destination: { surface: 'apps', target: 'nimi.parentos' }, anchor: 'app' },
    { destination: { surface: 'apps', target: 'nimi.parentos', view: 'access' }, anchor: 'access' },
  ] },
];

export const demoSectionIds = ['hero', 'apps', ...demoChapters.map(chapter => chapter.id), 'get-started'];
