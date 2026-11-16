import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';

import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { NimiUtopiaResident, NimiUtopiaSnapshot, NimiUtopiaTime } from '@nimiplatform/sdk/app';

import {
  buildContextualIcebreakers,
  resolveResidentPresence,
} from '../src/domain/agent-profiles.js';
import {
  BUILTIN_PACK_SLUGS,
  type InstalledUtopiaPack,
  type ResolvedStageMedia,
} from '../src/domain/bundle-registry.js';
import {
  parseAndValidateUtopiaZip,
  validateUtopiaBundleParts,
} from '../src/domain/bundle-validator.js';
import {
  CHIBI_CLOAK_OPTIONS,
  CHIBI_HEADWEAR_OPTIONS,
  isSameChibiAppearance,
  parseChibiWardrobePayload,
  randomizeChibiAppearance,
  seedDefaultChibiAppearance,
  type ChibiAppearance,
} from '../src/domain/chibi-wardrobe.js';
import { resolveWorldKineticProps, resolveWorldLandmarks } from '../src/domain/world-landmarks.js';
import {
  openHomePartnerManagementFromUtopia,
  openHomePartnersFromUtopia,
  openPartnerConversationInZhiyuFromUtopia,
} from '../src/domain/desktop-open.js';
import { computeVisitJournalHighlights } from '../src/domain/visit-journal.js';
import { DeterministicTunerPanel } from '../src/panels/DeterministicTunerPanel.js';
import { HorizonTopBar } from '../src/panels/HorizonTopBar.js';
import { JournalAndSharedTab } from '../src/panels/JournalAndSharedTab.js';
import {
  ResidentDetailAndDraft,
  createZeroSideEffectDraftState,
} from '../src/panels/ResidentDetailAndDraft.js';
import { computeResidentSpatialTargets } from '../src/stage/LivingResidentsLayer.js';
import { UtopiaStageViewport } from '../src/stage/UtopiaStageViewport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_PACKS_ROOT = path.resolve(__dirname, '../public/builtin-packs');

function toUtopiaTime(iso: string): NimiUtopiaTime {
  const ms = Date.parse(iso);
  return {
    seconds: String(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  };
}

async function loadInstalledBuiltinPack(slug: string): Promise<InstalledUtopiaPack> {
  const dir = path.join(PUBLIC_PACKS_ROOT, slug);
  const rawManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const rawHabitat = JSON.parse(await fs.readFile(path.join(dir, 'habitat.json'), 'utf8'));
  const rawStage = JSON.parse(await fs.readFile(path.join(dir, 'stage.json'), 'utf8'));
  const assetEntries = await fs.readdir(path.join(dir, 'assets'));
  const rawAssets = new Map<string, Uint8Array>();
  for (const name of assetEntries) {
    const bytes = new Uint8Array(await fs.readFile(path.join(dir, 'assets', name)));
    rawAssets.set(`assets/${name}`, bytes);
  }
  const validated = await validateUtopiaBundleParts({
    rawManifest,
    rawHabitat,
    rawStage,
    rawAssets,
    allowBuiltinNamespace: true,
  });
  return {
    source: 'builtin',
    slug,
    manifest: validated.manifest,
    habitat: validated.habitat,
    stage: validated.stage,
    contentDigest: validated.contentDigest,
    installedAt: 'builtin',
    assetRoot: null,
    assetPaths: Array.from(validated.assets.keys()),
  };
}

test('SSR DOM render: Expressive stage viewport, Universal Fallback Journal Stage, and operational chrome panels', async () => {
  const pack = await loadInstalledBuiltinPack('cloud-bamboo-abode');
  const assetUrls: Record<string, string> = {};
  for (const rel of pack.assetPaths) {
    assetUrls[rel] = `./builtin-packs/cloud-bamboo-abode/${rel}`;
  }
  const stageMedia: ResolvedStageMedia = {
    pack,
    assetUrls,
    revokeAll: async () => undefined,
  };

  const handleA = 'agent-modern' as NimiUtopiaResident['agentHandle'];
  const handleB = 'agent-fantasy' as NimiUtopiaResident['agentHandle'];
  const firstPlace = pack.habitat.places[0]!;
  const nowIso = '2026-11-15T10:30:00Z';
  const nowMs = Date.parse(nowIso);

  const snapshot: NimiUtopiaSnapshot = {
    revision: 'rev-10',
    observedAt: toUtopiaTime(nowIso),
    habitatActivationId: 'act-cloud-1',
    contentDigest: pack.contentDigest,
    timezone: 'Asia/Shanghai',
    publicParticipation: true,
    habitat: pack.habitat,
    parameterValues: Object.fromEntries(pack.habitat.parameters.map((p) => [p.key, p.defaultValue])),
    openPlaceIds: pack.habitat.places.map((p) => p.id),
    activeEvents: [
      {
        eventId: 'ev-1',
        slot: 'custom',
        sceneryKind: 'meteor-shower',
        label: '松岭流星雨',
        description: '夜空划过清亮星痕。',
        placeId: firstPlace.id,
        startsAt: toUtopiaTime('2026-11-15T10:00:00Z'),
        expiresAt: toUtopiaTime('2026-11-15T14:00:00Z'),
      },
    ],
    lastRelocation: {
      fromHabitatId: 'nimi.builtin.seaside-island',
      fromHabitatTitle: '海风渔岛',
      toHabitatId: pack.habitat.habitatId,
      toHabitatTitle: pack.habitat.title,
      relocatedAt: toUtopiaTime('2026-11-15T09:00:00Z'),
    },
    residents: [
      {
        agentHandle: handleA,
        displayName: '林夏',
        solitary: false,
        current: {
          activityId: 'brew-tea',
          title: '松风烹茶',
          habitatActivationId: 'act-cloud-1',
          habitatId: pack.habitat.habitatId,
          habitatTitle: pack.habitat.title,
          placeId: firstPlace.id,
          placeLabel: firstPlace.name,
          startsAt: toUtopiaTime('2026-11-15T10:15:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: {
          activityId: 'watch-birds',
          title: '栈桥观鸟',
          habitatActivationId: 'act-sea-0',
          habitatId: 'nimi.builtin.seaside-island',
          habitatTitle: '海风渔岛',
          placeId: 'bird-hide',
          placeLabel: '遮蔽观鸟棚',
          startsAt: toUtopiaTime('2026-11-15T08:00:00Z'),
          endsAt: toUtopiaTime('2026-11-15T08:45:00Z'),
          interaction: false,
        },
        next: null,
      },
      {
        agentHandle: handleB,
        displayName: '云鹤',
        solitary: false,
        current: {
          activityId: 'brew-tea',
          title: '松风烹茶',
          habitatActivationId: 'act-cloud-1',
          habitatId: pack.habitat.habitatId,
          habitatTitle: pack.habitat.title,
          placeId: firstPlace.id,
          placeLabel: firstPlace.name,
          startsAt: toUtopiaTime('2026-11-15T10:15:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: null,
        next: null,
      },
    ],
    occupancy: [
      { placeId: firstPlace.id, agentHandles: [handleA, handleB] },
    ],
    sharedActivities: [
      {
        activityRef: 'sa-tea',
        habitatActivationId: 'act-cloud-1',
        habitatId: pack.habitat.habitatId,
        habitatTitle: pack.habitat.title,
        placeId: firstPlace.id,
        placeLabel: firstPlace.name,
        activityId: 'brew-tea',
        activityLabel: '对坐煮雪烹茶',
        initiatorHandle: handleA,
        recipientHandle: handleB,
        state: 'active',
        acceptedAt: toUtopiaTime('2026-11-15T10:10:00Z'),
        startsAt: toUtopiaTime('2026-11-15T10:15:00Z'),
        endsAt: null,
      },
    ],
  };

  // 1. Expressive stage renders scoped [data-utopia-expressive-stage], layered img, and keyboard buttons
  const stageHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={snapshot}
      stageMedia={stageMedia}
      daypart="dusk"
      frozen={false}
      reducedMotion={true}
      transitioning={false}
      selectedPlaceId={firstPlace.id}
      selectedResidentHandle={null}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(stageHtml, /data-utopia-expressive-stage/);
  assert.match(stageHtml, new RegExp(pack.habitat.title));
  assert.match(stageHtml, /林夏/);
  assert.match(stageHtml, /对坐煮雪烹茶/);
  assert.match(stageHtml, /此刻正相伴于此/);
  assert.match(stageHtml, /utopia-chibi-full-svg/);
  assert.doesNotMatch(stageHtml, /utopia-chibi-wings/);

  // 2. Missing stageMedia (J6 step 3: external habitat without local art pack) gracefully renders Universal Fallback Journal Stage
  const fallbackHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={snapshot}
      stageMedia={null}
      daypart="night"
      frozen={true}
      reducedMotion={false}
      transitioning={false}
      selectedPlaceId={null}
      selectedResidentHandle={null}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(fallbackHtml, /通用风物手账视图/);
  assert.match(fallbackHtml, new RegExp(pack.habitat.personalQuarter.name));
  assert.match(fallbackHtml, new RegExp(firstPlace.name));

  // 3. HorizonTopBar in frozen mode surfaces timestamp & default-muted audio button
  const topBarHtml = renderToStaticMarkup(
    <HorizonTopBar
      snapshot={snapshot}
      daypart="night"
      nowMs={nowMs}
      frozen={true}
      audioMuted={true}
      hasAudioTrack={true}
      sidebarCollapsed={false}
      onToggleAudioMute={() => undefined}
      onOpenTuner={() => undefined}
      onOpenPackLibrary={() => undefined}
      onToggleSidebar={() => undefined}
      onRetryRefresh={() => undefined}
    />,
  );
  assert.match(topBarHtml, /松岭流星雨/);
  assert.match(topBarHtml, /等待连接 Runtime/);
  assert.match(topBarHtml, /开启洞天环境声景/);

  // 4. JournalAndSharedTab renders relocation highlight & active shared activity
  const highlights = computeVisitJournalHighlights(snapshot, null, nowMs);
  const journalHtml = renderToStaticMarkup(
    <JournalAndSharedTab
      snapshot={snapshot}
      highlights={highlights}
      onOpenDraft={() => undefined}
    />,
  );
  assert.match(journalHtml, /海风渔岛/);
  assert.match(journalHtml, /对坐煮雪烹茶/);
  assert.match(journalHtml, /街巷偶遇与小聚/);
  assert.doesNotMatch(journalHtml, /共同约定与安排/);

  // 5. ResidentDetailAndDraft renders zero-side-effect local draft box without mounting formal conversation session
  const stubClient = {} as NimiLocalAppClient;
  let sessionFactoryCalled = false;
  const draftState = createZeroSideEffectDraftState(snapshot.residents[0]!, '山里的茶香吗？');
  const residentsHtml = renderToStaticMarkup(
    <ResidentDetailAndDraft
      client={stubClient}
      snapshot={snapshot}
      busy={false}
      draftState={draftState}
      onDraftStateChange={() => undefined}
      onApplyIntent={async () => undefined}
      sessionFactory={() => {
        sessionFactoryCalled = true;
        throw new Error('Must not mount session while in zero-side-effect local draft');
      }}
    />,
  );
  assert.equal(sessionFactoryCalled, false);
  assert.match(residentsHtml, /山里的茶香吗？/);
  assert.match(residentsHtml, /海风渔岛·遮蔽观鸟棚/);

  // 6. DeterministicTunerPanel renders parameter knobs and active scenery countdown
  const tunerHtml = renderToStaticMarkup(
    <DeterministicTunerPanel
      client={stubClient}
      snapshot={snapshot}
      nowMs={nowMs}
      busy={false}
      onApplyIntent={async () => true}
    />,
  );
  assert.match(tunerHtml, /环境参数旋钮/);
  assert.match(tunerHtml, /松岭流星雨/);
});

test('Sample creator bundle (.utopia), Sanctuary Presence Dock, causal place unlock, and quick-dial Horizon controls', async () => {
  const sampleZipPath = path.resolve(__dirname, '../public/samples/creator.autumn-farm.utopia');
  const sampleBytes = new Uint8Array(await fs.readFile(sampleZipPath));
  const validatedSample = await parseAndValidateUtopiaZip(sampleBytes);
  assert.equal(validatedSample.manifest.bundleId, 'creator.autumn-farm');
  assert.equal(validatedSample.habitat.habitatId, 'creator.autumn-farm');
  assert.ok(validatedSample.habitat.places.length >= 3);
  assert.equal(validatedSample.stage.anchors.length, validatedSample.habitat.places.length + 1);

  const seasidePack = await loadInstalledBuiltinPack('seaside-island');
  const assetUrls: Record<string, string> = {};
  for (const rel of seasidePack.assetPaths) {
    assetUrls[rel] = `./builtin-packs/seaside-island/${rel}`;
  }
  const seasideMedia: ResolvedStageMedia = {
    pack: seasidePack,
    assetUrls,
    revokeAll: async () => undefined,
  };

  const tidePoolPlace = seasidePack.habitat.places.find((p) => p.openWhen.length > 0)!;
  const openOtherPlaces = seasidePack.habitat.places
    .filter((p) => p.id !== tidePoolPlace.id)
    .map((p) => p.id);

  const handleActive = 'agent-active' as NimiUtopiaResident['agentHandle'];
  const handleResting = 'agent-resting' as NimiUtopiaResident['agentHandle'];
  const handleSolitary = 'agent-solitary' as NimiUtopiaResident['agentHandle'];
  const nowIso = '2026-11-15T09:30:00Z';
  const nowMs = Date.parse(nowIso);

  const seasideSnapshot: NimiUtopiaSnapshot = {
    revision: 'rev-sea-2',
    observedAt: toUtopiaTime(nowIso),
    habitatActivationId: 'act-sea-2',
    contentDigest: seasidePack.contentDigest,
    timezone: 'Asia/Shanghai',
    publicParticipation: true,
    habitat: seasidePack.habitat,
    parameterValues: {
      ...Object.fromEntries(seasidePack.habitat.parameters.map((p) => [p.key, p.defaultValue])),
      tide: 'high-tide',
    },
    openPlaceIds: openOtherPlaces,
    activeEvents: [],
    lastRelocation: null,
    residents: [
      {
        agentHandle: handleActive,
        displayName: '阿潮',
        solitary: false,
        current: {
          activityId: 'mend-nets',
          title: '修补渔网',
          habitatActivationId: 'act-sea-2',
          habitatId: seasidePack.habitat.habitatId,
          habitatTitle: seasidePack.habitat.title,
          placeId: openOtherPlaces[0]!,
          placeLabel: seasidePack.habitat.places.find((p) => p.id === openOtherPlaces[0])!.name,
          startsAt: toUtopiaTime('2026-11-15T09:00:00Z'),
          endsAt: null,
          interaction: false,
        },
        recent: null,
        next: null,
      },
      {
        agentHandle: handleResting,
        displayName: '白鸥',
        solitary: false,
        current: null,
        recent: null,
        next: null,
      },
      {
        agentHandle: handleSolitary,
        displayName: '静岚',
        solitary: true,
        current: null,
        recent: null,
        next: null,
      },
    ],
    occupancy: [{ placeId: openOtherPlaces[0]!, agentHandles: [handleActive] }],
    sharedActivities: [],
  };

  // Resting/unscheduled companion never gets a fabricated public placeId or fake activity label
  const restingPresence = resolveResidentPresence(seasideSnapshot.residents[1]!, seasideSnapshot);
  assert.equal(restingPresence.tone, 'resting');
  assert.equal(restingPresence.focusPlaceId, null);
  assert.equal(restingPresence.statusBadge, '空闲中');

  const solitaryPresence = resolveResidentPresence(seasideSnapshot.residents[2]!, seasideSnapshot);
  assert.equal(solitaryPresence.tone, 'solitary');
  assert.equal(solitaryPresence.focusPlaceId, 'personal-quarter');

  const icebreakers = buildContextualIcebreakers(seasideSnapshot.residents[0]!, seasideSnapshot);
  assert.ok(icebreakers.length >= 2);
  assert.match(icebreakers[0]!.prefill, /修补渔网/);

  // Hand-drawn chibi wardrobe deterministic seeding, randomization, and boundary validation
  const seededAchao = seedDefaultChibiAppearance(handleActive);
  assert.deepEqual(seededAchao, seedDefaultChibiAppearance(handleActive));
  const randomizedAchao = randomizeChibiAppearance(seededAchao);
  assert.equal(isSameChibiAppearance(seededAchao, randomizedAchao), false);

  const customSproutLook: ChibiAppearance = {
    skinTone: 'butter',
    hairStyle: 'twintails',
    hairColor: 'honey-gold',
    eyes: 'starry',
    headwear: 'sprout',
    cloakColor: 'mint',
  };
  const parsedWardrobe = parseChibiWardrobePayload({
    entries: {
      [handleActive]: customSproutLook,
      malformed: { skinTone: 'invalid-tone' },
    },
  });
  assert.deepEqual(parsedWardrobe[handleActive], customSproutLook);
  assert.equal('malformed' in parsedWardrobe, false);

  // Stage renders pure hand-drawn chibi sprites & dock medallions (never raw LocalAgent photo URLs) + causal place unlock
  const stageWithClosedPlaceHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={seasideSnapshot}
      stageMedia={seasideMedia}
      daypart="morning"
      frozen={false}
      reducedMotion={false}
      transitioning={false}
      selectedPlaceId={tidePoolPlace.id}
      selectedResidentHandle={handleActive}
      chibiWardrobe={parsedWardrobe}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
      onQuickApplyParameters={() => undefined}
    />,
  );
  assert.match(stageWithClosedPlaceHtml, /洞天伙伴行迹席/);
  assert.match(stageWithClosedPlaceHtml, /白鸥/);
  assert.match(stageWithClosedPlaceHtml, /暂无当前活动 · 待下一段日程/);
  assert.match(stageWithClosedPlaceHtml, /全住地环境生效/);
  assert.match(stageWithClosedPlaceHtml, /data-utopia-chibi-headwear="sprout"/);
  assert.doesNotMatch(stageWithClosedPlaceHtml, /https:\/\/example\.invalid\/avatar-achao\.png/);
  assert.match(stageWithClosedPlaceHtml, /调至开放条件/);

  // Character detail panel (`ResidentDetailAndDraft`) prominently renders the real LocalAgent avatar + chibi customizer bar
  const detailWithAgentAvatarHtml = renderToStaticMarkup(
    <ResidentDetailAndDraft
      client={{} as NimiLocalAppClient}
      snapshot={seasideSnapshot}
      busy={false}
      draftState={createZeroSideEffectDraftState(seasideSnapshot.residents[0]!, '')}
      avatarsByHandle={{
        [handleActive]: 'https://example.invalid/avatar-achao.png',
      }}
      chibiWardrobe={parsedWardrobe}
      onDraftStateChange={() => undefined}
      onApplyIntent={async () => undefined}
    />,
  );
  assert.match(detailWithAgentAvatarHtml, /https:\/\/example\.invalid\/avatar-achao\.png/);
  assert.match(detailWithAgentAvatarHtml, /洞天手绘小人/);
  assert.match(detailWithAgentAvatarHtml, /已定制/);
  assert.match(detailWithAgentAvatarHtml, /森系嫩芽 · 双团子 · 海盐薄荷/);

  // HorizonTopBar renders interactive quick-cycle parameter button + volume slider + floating drawer tabs when provided
  const interactiveHorizonHtml = renderToStaticMarkup(
    <HorizonTopBar
      snapshot={seasideSnapshot}
      daypart="morning"
      nowMs={nowMs}
      frozen={false}
      audioMuted={false}
      audioVolume={0.65}
      hasAudioTrack={true}
      sidebarCollapsed={false}
      activeDrawerTab="residents"
      residentCount={3}
      onSelectDrawerTab={() => undefined}
      onToggleAudioMute={() => undefined}
      onAudioVolumeChange={() => undefined}
      onQuickCycleParameter={() => undefined}
      onOpenTuner={() => undefined}
      onOpenPackLibrary={() => undefined}
      onToggleSidebar={() => undefined}
      onRetryRefresh={() => undefined}
    />,
  );
  assert.match(interactiveHorizonHtml, /点击切换为/);
  assert.match(interactiveHorizonHtml, /环境声景音量/);
  assert.match(interactiveHorizonHtml, /value="65"/);
  assert.match(interactiveHorizonHtml, /伙伴 \(3\)/);
  assert.match(interactiveHorizonHtml, /展卷迁居/);

  // Embodied 2.5D spatial target resolver places scheduled companion at courtyard, solitary companion at personalQuarter,
  // and unscheduled companion on neutral walkway (`stationary === false`) without fabricating any placeId
  const spatial = computeResidentSpatialTargets(seasideSnapshot, seasidePack.stage);
  assert.equal(spatial.slots.length, 3);
  const activeSlot = spatial.slots.find((s) => s.resident.agentHandle === handleActive)!;
  const roamerSlot = spatial.slots.find((s) => s.resident.agentHandle === handleResting)!;
  const solitarySlot = spatial.slots.find((s) => s.resident.agentHandle === handleSolitary)!;

  assert.equal(activeSlot.stationary, true);
  assert.equal(activeSlot.bubbleText, '修补渔网');
  assert.equal(roamerSlot.stationary, false);
  assert.equal(roamerSlot.bubbleText, null);
  assert.equal(roamerSlot.presence.focusPlaceId, null);
  assert.equal(solitarySlot.stationary, true);
  assert.equal(solitarySlot.bubbleText, '安静独处');

  // Stage renders embodied chibi sprites, scenic landmarks, interactive mini-map, and multi-scale camera controls
  assert.match(stageWithClosedPlaceHtml, /data-utopia-resident-sprite="agent-active"/);
  assert.match(stageWithClosedPlaceHtml, /洞天风物观景地标/);
  assert.match(stageWithClosedPlaceHtml, /海角红白灯塔/);
  assert.match(stageWithClosedPlaceHtml, /洞天舆图/);
  assert.match(stageWithClosedPlaceHtml, /全景/);
  assert.match(stageWithClosedPlaceHtml, /缩小画卷视野/);
  assert.match(stageWithClosedPlaceHtml, /放大画卷细节/);

  // Expanded Round-4 world scale: 4 built-in packs + 9-place starfield-town / polar-station / cloud-bamboo-abode / autumn-farm + 12 headwear options
  assert.deepEqual(BUILTIN_PACK_SLUGS, [
    'seaside-island',
    'starfield-town',
    'polar-station',
    'cloud-bamboo-abode',
  ]);
  assert.equal(CHIBI_HEADWEAR_OPTIONS.length, 12);
  assert.equal(CHIBI_CLOAK_OPTIONS.length, 10);
  assert.equal(validatedSample.habitat.places.length, 8);
  assert.equal(validatedSample.stage.anchors.length, 9);

  const starfieldPack = await loadInstalledBuiltinPack('starfield-town');
  assert.equal(starfieldPack.habitat.places.length, 8);
  assert.equal(starfieldPack.stage.anchors.length, 9);
  assert.ok(resolveWorldLandmarks('nimi.builtin.starfield-town').length >= 4);
  assert.ok(resolveWorldKineticProps('nimi.builtin.starfield-town').length >= 3);

  const starfieldAssets: Record<string, string> = {};
  for (const rel of starfieldPack.assetPaths) {
    starfieldAssets[rel] = `./builtin-packs/starfield-town/${rel}`;
  }
  const starfieldSnapshot: NimiUtopiaSnapshot = {
    ...seasideSnapshot,
    habitatActivationId: 'act-starfield-1',
    contentDigest: starfieldPack.contentDigest,
    habitat: starfieldPack.habitat,
    parameterValues: Object.fromEntries(starfieldPack.habitat.parameters.map((p) => [p.key, p.defaultValue])),
    openPlaceIds: starfieldPack.habitat.places.map((p) => p.id),
    occupancy: [],
  };
  const customSailorLook: ChibiAppearance = {
    skinTone: 'peach',
    hairStyle: 'fluffy',
    hairColor: 'chestnut',
    eyes: 'gentle',
    headwear: 'sailor-cap',
    cloakColor: 'coral',
  };
  const starfieldHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={starfieldSnapshot}
      stageMedia={{ pack: starfieldPack, assetUrls: starfieldAssets, revokeAll: async () => undefined }}
      daypart="day"
      frozen={false}
      reducedMotion={false}
      transitioning={false}
      selectedPlaceId={null}
      selectedResidentHandle={null}
      chibiWardrobe={{ [handleActive]: customSailorLook }}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(starfieldHtml, /星泉中心广场/);
  assert.match(starfieldHtml, /晴岚热气球坪/);
  assert.match(starfieldHtml, /西坡薰衣草垄/);
  assert.match(starfieldHtml, /9 场所 · 4 风物/);
  assert.match(starfieldHtml, /data-utopia-chibi-headwear="sailor-cap"/);
  assert.match(starfieldHtml, /data-utopia-canvas-renderer="retina-2d"/);
  assert.doesNotMatch(starfieldHtml, /utopia-stage-layer-img/);
  assert.equal(starfieldPack.stage.layers[0]?.assetPath, 'assets/sky.webp');
  assert.equal(seasidePack.stage.layers[0]?.assetPath, 'assets/sky.webp');
  assert.equal(validatedSample.stage.layers[0]?.assetPath, 'assets/sky.webp');

  // 0-resident onboarding guidance + FallbackJournalStage distinct packFallbackReason notices
  const zeroResidentSnapshot: NimiUtopiaSnapshot = {
    ...seasideSnapshot,
    residents: [],
    occupancy: [],
    sharedActivities: [],
  };
  const emptyDockStageHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={zeroResidentSnapshot}
      stageMedia={seasideMedia}
      daypart="day"
      frozen={false}
      reducedMotion={true}
      transitioning={false}
      selectedPlaceId={null}
      selectedResidentHandle={null}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(emptyDockStageHtml, /尚无自治伙伴入住/);
  assert.match(emptyDockStageHtml, /Nimi Home/);

  const mismatchFallbackHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={zeroResidentSnapshot}
      stageMedia={null}
      packFallbackReason="version-mismatch"
      daypart="day"
      frozen={false}
      reducedMotion={true}
      transitioning={false}
      selectedPlaceId={null}
      selectedResidentHandle={null}
      onOpenPackLibrary={() => undefined}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(mismatchFallbackHtml, /data-utopia-pack-fallback-reason="version-mismatch"/);
  assert.match(mismatchFallbackHtml, /打开画卷库/);

  const indexErrFallbackHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={zeroResidentSnapshot}
      stageMedia={null}
      packFallbackReason="pack-index-error"
      packFallbackDetail="索引文件损坏"
      daypart="day"
      frozen={false}
      reducedMotion={true}
      transitioning={false}
      selectedPlaceId={null}
      selectedResidentHandle={null}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(indexErrFallbackHtml, /data-utopia-pack-fallback-reason="pack-index-error"/);
  assert.match(indexErrFallbackHtml, /索引文件损坏/);

  // HorizonTopBar visibly surfaces interruption count directly on the parameter pill BEFORE clicking
  const occupiedDeckSnapshot: NimiUtopiaSnapshot = {
    ...seasideSnapshot,
    parameterValues: { weather: 'sunny-breeze', tide: 'low-tide' },
    residents: [
      {
        agentHandle: handleActive,
        displayName: '阿青',
        solitary: false,
        current: {
          activityId: 'tidepool-search',
          title: '礁石拾贝',
          habitatActivationId: seasideSnapshot.habitatActivationId,
          habitatId: seasideSnapshot.habitat.habitatId,
          habitatTitle: seasideSnapshot.habitat.title,
          placeId: 'tidal-reef',
          placeLabel: '退潮礁滩',
          startsAt: toUtopiaTime('2026-11-15T09:50:00Z'),
          endsAt: toUtopiaTime('2026-11-15T10:30:00Z'),
          interaction: false,
        },
        recent: null,
        next: null,
      },
    ],
  };
  const warnPillHorizonHtml = renderToStaticMarkup(
    <HorizonTopBar
      snapshot={occupiedDeckSnapshot}
      daypart="morning"
      nowMs={nowMs}
      frozen={false}
      audioMuted={true}
      hasAudioTrack={false}
      sidebarCollapsed={true}
      onToggleAudioMute={() => undefined}
      onQuickCycleParameter={() => undefined}
      onOpenTuner={() => undefined}
      onOpenPackLibrary={() => undefined}
      onToggleSidebar={() => undefined}
      onRetryRefresh={() => undefined}
    />,
  );
  assert.match(warnPillHorizonHtml, /utopia-pill-impact-tag is-warn/);
  assert.match(warnPillHorizonHtml, /将打断1人/);

  // Home DesktopOpenIntent adaptation: open-partners for 0-resident & zero-side-effect draft, open-agent-center when anchor is mounted
  const capturedIntents: unknown[] = [];
  const okPartners = await openHomePartnersFromUtopia(undefined, async (req) => {
    capturedIntents.push(req.intent);
    return {
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: 'desktop-open-bridge-1',
      requestId: 'desktop-open-req-1',
      appliedTarget: 'open-partners',
    };
  });
  assert.equal(okPartners.ok, true);
  assert.deepEqual(capturedIntents[0], { kind: 'open-partners' });

  const okDraftPartner = await openHomePartnerManagementFromUtopia(
    { conversationAnchorId: null, displayName: '  阿青  ' },
    async (req) => {
      capturedIntents.push(req.intent);
      return {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-bridge-1',
        requestId: 'desktop-open-req-2',
        appliedTarget: 'open-partners',
      };
    },
  );
  assert.equal(okDraftPartner.ok, true);
  assert.deepEqual(capturedIntents[1], { kind: 'open-partners', query: '阿青' });

  const okAnchored = await openHomePartnerManagementFromUtopia(
    { conversationAnchorId: 'anchor_aqing_01', displayName: '阿青' },
    async (req) => {
      capturedIntents.push(req.intent);
      return {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-bridge-1',
        requestId: 'desktop-open-req-3',
        appliedTarget: 'open-agent-center',
      };
    },
  );
  assert.equal(okAnchored.ok, true);
  assert.deepEqual(capturedIntents[2], { kind: 'open-agent-center', conversationAnchorId: 'anchor_aqing_01' });

  const rejectedHome = await openHomePartnersFromUtopia(undefined, async () => ({
    status: 'rejected',
    reasonCode: 'desktop-open-desktop-not-running',
    actionHint: 'open_desktop_first',
  }));
  assert.equal(rejectedHome.ok, false);
  if (!rejectedHome.ok) {
    assert.match(rejectedHome.message, /请先启动 Nimi Home/);
  }

  const emptySnapshot: NimiUtopiaSnapshot = {
    ...seasideSnapshot,
    residents: [],
    occupancy: [],
    sharedActivities: [],
  };
  const emptyViewportHtml = renderToStaticMarkup(
    <UtopiaStageViewport
      snapshot={emptySnapshot}
      stageMedia={seasideMedia}
      daypart="morning"
      frozen={false}
      reducedMotion={true}
      transitioning={false}
      selectedPlaceId={null}
      selectedResidentHandle={null}
      onOpenHomePartners={() => undefined}
      onSelectPlace={() => undefined}
      onSelectResident={() => undefined}
    />,
  );
  assert.match(emptyViewportHtml, /前往 Home「我的伙伴」/);

  const stubClient = {} as NimiLocalAppClient;
  const focusedHtml = renderToStaticMarkup(
    <ResidentDetailAndDraft
      client={stubClient}
      snapshot={occupiedDeckSnapshot}
      busy={false}
      draftState={createZeroSideEffectDraftState(occupiedDeckSnapshot.residents[0]!, '')}
      onDraftStateChange={() => undefined}
      onApplyIntent={async () => undefined}
      onOpenHomePartners={() => undefined}
      onOpenHomePartnerManagement={() => undefined}
      onOpenPartnerInZhiyu={async () => true}
    />,
  );
  assert.match(focusedHtml, /在 Home 管理/);
  assert.match(focusedHtml, /给 阿青 留张门前便签/);
  assert.match(focusedHtml, /去织羽深聊/);
  assert.match(focusedHtml, /递句话/);
  assert.doesNotMatch(focusedHtml, /查看聊天记录/);

  // Zhiyu doorstep handoff: reuses mounted anchor or resolves via openConversation, carrying unsent draft
  let openConvCalls = 0;
  const handoffFromDraft = await openPartnerConversationInZhiyuFromUtopia(
    {
      agentHandle: handleActive,
      mountedAnchorId: null,
      draftText: '  潮声茶棚的雨停了吗？  ',
      openConversation: async (req) => {
        openConvCalls += 1;
        assert.equal(req.agentHandle, handleActive);
        return { conversationAnchorId: 'anchor_aqing_draft' };
      },
    },
    async (req) => {
      capturedIntents.push(req.intent);
      return {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-bridge-1',
        requestId: 'desktop-open-req-4',
        appliedTarget: 'open-partner-conversation',
      };
    },
  );
  assert.equal(handoffFromDraft.ok, true);
  assert.equal(openConvCalls, 1);
  assert.deepEqual(capturedIntents[3], {
    kind: 'open-partner-conversation',
    conversationAnchorId: 'anchor_aqing_draft',
    text: '潮声茶棚的雨停了吗？',
  });

  const handoffFromMounted = await openPartnerConversationInZhiyuFromUtopia(
    {
      agentHandle: handleActive,
      mountedAnchorId: 'anchor_already_mounted',
      draftText: '',
      openConversation: async () => {
        openConvCalls += 1;
        return { conversationAnchorId: 'should_not_be_called' };
      },
    },
    async (req) => {
      capturedIntents.push(req.intent);
      return {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-bridge-1',
        requestId: 'desktop-open-req-5',
        appliedTarget: 'open-partner-conversation',
      };
    },
  );
  assert.equal(handoffFromMounted.ok, true);
  assert.equal(openConvCalls, 1, 'already mounted anchor must not trigger a second openConversation RPC');
  assert.deepEqual(capturedIntents[4], {
    kind: 'open-partner-conversation',
    conversationAnchorId: 'anchor_already_mounted',
  });

  const rejectedZhiyu = await openPartnerConversationInZhiyuFromUtopia(
    {
      agentHandle: handleActive,
      mountedAnchorId: 'anchor_already_mounted',
      draftText: '保留我的便签',
      openConversation: async () => ({ conversationAnchorId: 'anchor_already_mounted' }),
    },
    async () => ({
      status: 'rejected',
      reasonCode: 'desktop-open-desktop-not-ready',
      actionHint: 'wait_for_desktop_ready',
    }),
  );
  assert.equal(rejectedZhiyu.ok, false);
  if (!rejectedZhiyu.ok) {
    assert.match(rejectedZhiyu.message, /门前草稿已为你保留/);
  }

  // Over-limit draft (> 8,000 chars) fails closed without truncation, RPC, or desktop-open invocation
  const overLimitDraft = '海'.repeat(8001);
  let overLimitOpenCalls = 0;
  let overLimitInvokeCalls = 0;
  const rejectedOverLimit = await openPartnerConversationInZhiyuFromUtopia(
    {
      agentHandle: handleActive,
      mountedAnchorId: null,
      draftText: overLimitDraft,
      openConversation: async () => {
        overLimitOpenCalls += 1;
        return { conversationAnchorId: 'anchor_never_used' };
      },
    },
    async () => {
      overLimitInvokeCalls += 1;
      return {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-bridge-1',
        requestId: 'desktop-open-req-never',
        appliedTarget: 'open-partner-conversation',
      };
    },
  );
  assert.equal(rejectedOverLimit.ok, false);
  if (!rejectedOverLimit.ok) {
    assert.equal(rejectedOverLimit.reasonCode, 'draft-too-long');
    assert.match(rejectedOverLimit.message, /超过织羽交接上限/);
  }
  assert.equal(overLimitOpenCalls, 0);
  assert.equal(overLimitInvokeCalls, 0);

  // Wardrobe not-yet-hydrated disables customize/random controls; publicParticipation=false keeps individual solitude Toggle enabled; over-limit draft renders alert
  const unhydratedQuietSnapshot: NimiUtopiaSnapshot = {
    ...occupiedDeckSnapshot,
    publicParticipation: false,
    residents: [
      { ...occupiedDeckSnapshot.residents[0]!, current: null, solitary: false },
      {
        ...occupiedDeckSnapshot.residents[0]!,
        agentHandle: 'agent_peer_quiet' as NimiUtopiaSnapshot['residents'][number]['agentHandle'],
        displayName: '阿白',
        current: null,
        solitary: true,
      },
    ],
  };
  const guardedPanelHtml = renderToStaticMarkup(
    <ResidentDetailAndDraft
      client={stubClient}
      snapshot={unhydratedQuietSnapshot}
      busy={false}
      wardrobeReady={false}
      draftState={createZeroSideEffectDraftState(unhydratedQuietSnapshot.residents[0]!, overLimitDraft)}
      onDraftStateChange={() => undefined}
      onApplyIntent={async () => undefined}
      onOpenPartnerInZhiyu={async () => true}
    />,
  );
  assert.match(guardedPanelHtml, /读取衣柜中…/);
  assert.match(guardedPanelHtml, /超过织羽交接上限（8000 字）/);
  assert.match(guardedPanelHtml, /不再独自前往公共场所|当前街巷串门与小聚仍为关闭/);
  const solitudeSwitchTag = guardedPanelHtml.match(/<button[^>]*aria-label="设置 阿青 安静独处"[^>]*>/)?.[0] ?? '';
  assert.ok(solitudeSwitchTag, 'solitude switch for 阿青 must be rendered');
  assert.doesNotMatch(
    solitudeSwitchTag,
    /\sdisabled(?:=|\s|>)/,
    'individual solitude toggle must remain enabled even when publicParticipation is false',
  );
});
