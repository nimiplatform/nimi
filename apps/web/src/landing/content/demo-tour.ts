import type { DemoDestination, PreviewDestination, PreviewScreen } from './demo-navigation.js';

export const COURTYARD_PARTNER = 'demo:emberware-court:character-0';
export const EXAMPLE_LOG = 'ai:log-example';

type Stop = { destination: DemoDestination; anchor: string; preview?: PreviewDestination };
type Chapter = { id: string; copy: 'worlds' | 'capabilities' | 'riskControl' | 'create' | 'continuity' | 'developers'; stops: readonly [Stop, ...Stop[]] };

function appStop(appId: string, screen: PreviewScreen, anchor: string): Stop {
  return { destination: { surface: 'apps', target: appId }, preview: { appId, screen }, anchor };
}

export const demoChapters: readonly Chapter[] = [
  { id: 'worlds', copy: 'worlds', stops: [
    { destination: { surface: 'explore', target: 'world:emberware-court' }, anchor: 'world' },
    { destination: { surface: 'explore', target: 'character:' + COURTYARD_PARTNER }, anchor: 'character' },
    { destination: { surface: 'chat', target: COURTYARD_PARTNER }, anchor: 'transcript' },
  ] },
  { id: 'models', copy: 'capabilities', stops: [
    { destination: { surface: 'runtime' }, anchor: 'ready' },
    { destination: { surface: 'runtime', target: 'text.generate' }, anchor: 'model' },
    { destination: { surface: 'cloud' }, anchor: 'cloud-add' },
    { destination: { surface: 'cloud', target: 'catalog' }, anchor: 'cloud-catalog' },
  ] },
  // @nimi-authority: rule.nimi.runtime.ai-provider.text-content-boundaries
  { id: 'risk-control', copy: 'riskControl', stops: [
    { destination: { surface: 'chat', target: EXAMPLE_LOG, view: 'draft' }, anchor: 'composer' },
    { destination: { surface: 'chat', target: EXAMPLE_LOG, view: 'blocked' }, anchor: 'refusal' },
    { destination: { surface: 'chat', target: EXAMPLE_LOG, view: 'edited' }, anchor: 'composer' },
  ] },
  { id: 'create', copy: 'create', stops: [
    { destination: { surface: 'apps', target: 'nimi.parentos' }, anchor: 'launch' },
    appStop('nimi.parentos', 'home', 'parent-home'),
    appStop('nimi.parentos', 'journal', 'journal'),
    appStop('nimi.parentos', 'keepsakes', 'journal-filter'),
  ] },
  { id: 'continuity', copy: 'continuity', stops: [
    { destination: { surface: 'chat', target: COURTYARD_PARTNER }, anchor: 'transcript' },
    { destination: { surface: 'apps', target: 'nimi.zhiyu' }, anchor: 'launch' },
    appStop('nimi.zhiyu', 'home', 'choose-partner'),
    appStop('nimi.zhiyu', 'companion', 'partner-chat'),
    appStop('nimi.zhiyu', 'memory', 'memory'),
  ] },
  // @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042d
  { id: 'developers', copy: 'developers', stops: [
    { destination: { surface: 'settings', target: 'developer' }, anchor: 'developer' },
    { destination: { surface: 'apps', target: 'nimi.parentos' }, anchor: 'app' },
    { destination: { surface: 'apps', target: 'nimi.parentos', view: 'access' }, anchor: 'access' },
  ] },
];

export const demoSectionIds = ['hero', 'apps', ...demoChapters.map(chapter => chapter.id), 'get-started'];
