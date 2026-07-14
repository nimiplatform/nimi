import fs from 'node:fs';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  handleLocalAgentProviderControl,
  handleLocalAgentProviderRequest,
} from './local-agent-provider-fixture.mjs';
import {
  configureFixtureRealmIssuer,
  createFixtureSourceMaterializationPacket,
  FIXTURE_SOURCE_MATERIALIZATION_JWKS,
} from './source-materialization-packet-v2.mjs';

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload)}\n`);
}

function options(response) {
  response.statusCode = 204;
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.end();
}

function notFound(response, pathname) {
  json(response, 404, {
    error: 'fixture_not_found',
    pathname,
  });
}

function validatedDesktopOauthRedirect(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(hostname)
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.pathname !== '/oauth/callback') {
    return null;
  }
  return parsed;
}

function fixtureSvg(name) {
  const label = String(name || 'fixture').replace(/[^a-z0-9 -]/gi, ' ').trim() || 'fixture';
  const colors = label.includes('cover') || label.includes('banner') || label.includes('hero')
    ? ['#30251f', '#71563f', '#c9a56c']
    : ['#1d3f34', '#4f8f65', '#d9c28f'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="0.55" stop-color="${colors[1]}"/>
      <stop offset="1" stop-color="${colors[2]}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="720" fill="url(#g)"/>
  <circle cx="840" cy="250" r="185" fill="rgba(255,255,255,.18)"/>
  <rect x="120" y="130" width="270" height="460" rx="36" fill="rgba(255,255,255,.16)"/>
  <text x="450" y="350" fill="#fff8e7" font-family="Arial, sans-serif" font-size="64" font-weight="700">${label}</text>
</svg>`;
}

function fixtureSilentWav() {
  const sampleRate = 8000;
  const durationSamples = 800;
  const dataSize = durationSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function serveFixtureMedia(response, pathname) {
  const match = pathname.match(/^\/__fixture\/media\/([^/]+)\.(svg|wav)$/u);
  if (!match) {
    return false;
  }
  const [, name, extension] = match;
  response.statusCode = 200;
  response.setHeader('access-control-allow-origin', '*');
  if (extension === 'svg') {
    response.setHeader('content-type', 'image/svg+xml; charset=utf-8');
    response.end(fixtureSvg(decodeURIComponent(name || 'fixture')));
    return true;
  }
  response.setHeader('content-type', 'audio/wav');
  response.end(fixtureSilentWav());
  return true;
}

function trimHandle(value) {
  return String(value || '').trim().replace(/^[@~]/u, '');
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function lookupUser(manifest, idOrHandle, mode) {
  const fixture = manifest.realmFixture || {};
  const users = [];
  if (fixture.currentUser) {
    users.push(fixture.currentUser);
  }
  const friendItems = Array.isArray(fixture.friends?.items) ? fixture.friends.items : [];
  const blockedItems = Array.isArray(fixture.blocked?.items) ? fixture.blocked.items : [];
  const creatorCharacters = Array.isArray(fixture.creatorCharacters) ? fixture.creatorCharacters : [];
  const searchUsers = Array.isArray(fixture.searchUsers?.items) ? fixture.searchUsers.items : [];
  users.push(...friendItems, ...blockedItems, ...creatorCharacters, ...searchUsers);
  if (mode === 'id') {
    return users.find((item) => String(item?.id || '') === idOrHandle) || null;
  }
  const normalized = trimHandle(idOrHandle);
  return users.find((item) => trimHandle(item?.handle) === normalized) || null;
}

function lookupWorld(manifest, worldId) {
  const worlds = Array.isArray(manifest.realmFixture?.worlds) ? manifest.realmFixture.worlds : [];
  return worlds.find((item) => String(item?.id || '') === String(worldId || '')) || null;
}

function lookupCharacter(manifest, characterId) {
  const fixture = manifest.realmFixture || {};
  const characters = [];
  if (Array.isArray(fixture.creatorCharacters)) {
    characters.push(...fixture.creatorCharacters);
  }
  if (Array.isArray(fixture.searchUsers?.items)) {
    characters.push(...fixture.searchUsers.items.filter((item) => item?.isSource === true));
  }
  if (Array.isArray(fixture.friends?.items)) {
    characters.push(...fixture.friends.items.filter((item) => item?.isSource === true));
  }
  for (const world of Array.isArray(fixture.worlds) ? fixture.worlds : []) {
    if (Array.isArray(world?.characters)) {
      characters.push(...world.characters);
    }
  }
  return characters.find((item) => String(item?.id || '') === String(characterId || '')) || null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function publicUrl(value) {
  const normalized = String(value || '').trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function publicMediaAsset(refId, kind, url, extra = {}) {
  const publicUri = publicUrl(url);
  if (!refId || !kind || !publicUri) {
    return null;
  }
  return {
    id: refId,
    kind,
    url: publicUri,
    provider: extra.provider || 'E2E_PUBLIC',
    mimeType: extra.mimeType ?? null,
    width: extra.width ?? null,
    height: extra.height ?? null,
    durationSec: extra.durationSec ?? null,
    sha256: extra.sha256 ?? null,
    provenance: extra.provenance ?? null,
  };
}

function normalizeWorldMedia(world) {
  const media = world?.media || {};
  const assets = media.assets || {};
  const iconUrl = publicUrl(media.iconUrl ?? world?.iconUrl);
  const bannerUrl = publicUrl(media.bannerUrl ?? world?.bannerUrl);
  const heroUrl = publicUrl(media.heroUrl ?? world?.heroUrl ?? world?.bannerUrl);
  const highlightUrls = asArray(media.highlightUrls ?? world?.highlightUrls).map(publicUrl).filter(Boolean);
  return {
    iconUrl,
    bannerUrl,
    heroUrl,
    highlightUrls,
    assets: {
      icon: assets.icon || publicMediaAsset(`${text(world?.id, 'world-e2e-1')}-icon`, 'icon', iconUrl),
      banner: assets.banner || publicMediaAsset(`${text(world?.id, 'world-e2e-1')}-banner`, 'banner', bannerUrl),
      hero: assets.hero || publicMediaAsset(`${text(world?.id, 'world-e2e-1')}-hero`, 'hero', heroUrl),
      highlights: Array.isArray(assets.highlights)
        ? assets.highlights
        : highlightUrls.map((url, index) => publicMediaAsset(`${text(world?.id, 'world-e2e-1')}-highlight-${index + 1}`, 'highlight', url)).filter(Boolean),
    },
  };
}

function normalizeSourceMedia(source) {
  const media = source?.media || {};
  const assets = media.assets || {};
  const id = text(source?.id, 'source-fixture');
  const avatarUrl = publicUrl(media.avatarUrl ?? source?.avatarUrl);
  const portraitUrl = publicUrl(media.portraitUrl ?? source?.portraitUrl);
  const profileCoverUrl = publicUrl(media.profileCoverUrl ?? source?.profileCoverUrl);
  const referenceImageUrl = publicUrl(media.referenceImageUrl ?? source?.referenceImageUrl);
  const voiceSampleUrl = publicUrl(media.voiceSampleUrl ?? source?.voiceSampleUrl);
  return {
    avatarUrl,
    portraitUrl,
    profileCoverUrl,
    referenceImageUrl,
    voiceSampleUrl,
    assets: {
      avatar: assets.avatar || publicMediaAsset(`${id}-avatar`, 'avatar', avatarUrl),
      portrait: assets.portrait || publicMediaAsset(`${id}-portrait`, 'portrait', portraitUrl),
      profileCover: assets.profileCover || publicMediaAsset(`${id}-profileCover`, 'profileCover', profileCoverUrl),
      referenceImage: assets.referenceImage || publicMediaAsset(`${id}-referenceImage`, 'referenceImage', referenceImageUrl),
      voiceSample: assets.voiceSample || publicMediaAsset(`${id}-voiceSample`, 'voiceSample', voiceSampleUrl, {
        provider: 'E2E_AUDIO',
        mimeType: source?.voiceSampleMimeType || 'audio/wav',
        durationSec: source?.voiceSampleDurationSec ?? null,
      }),
    },
  };
}

function projectPublicScene(scene, index) {
  const fallbackId = `scene-${index + 1}`;
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    const name = text(scene, `Scene ${index + 1}`);
    return {
      sceneId: fallbackId,
      name,
      summary: name,
      media: [],
      activeEntities: [],
      relatedCharacters: [],
      relatedEvents: [],
      relatedResources: [],
      counts: {
        activeEntityCount: 0,
        relatedCharacterCount: 0,
        relatedEventCount: 0,
        relatedResourceCount: 0,
      },
    };
  }

  const activeEntities = asArray(scene.activeEntities);
  const relatedCharacters = asArray(scene.relatedCharacters);
  const relatedEvents = asArray(scene.relatedEvents);
  const relatedResources = asArray(scene.relatedResources);
  const sceneId = text(scene.sceneId || scene.id, fallbackId);
  const name = text(scene.name || scene.title || scene.summary, `Scene ${index + 1}`);
  return {
    ...scene,
    sceneId,
    name,
    summary: text(scene.summary || scene.description, name),
    media: asArray(scene.media),
    activeEntities,
    relatedCharacters,
    relatedEvents,
    relatedResources,
    counts: scene.counts && typeof scene.counts === 'object' && !Array.isArray(scene.counts)
      ? scene.counts
      : {
          activeEntityCount: activeEntities.length,
          relatedCharacterCount: relatedCharacters.length,
          relatedEventCount: relatedEvents.length,
          relatedResourceCount: relatedResources.length,
        },
  };
}

function projectPublicWorld(world) {
  const tags = asArray(world?.tags).length ? asArray(world.tags) : asArray(world?.themes);
  const computedTime = world?.computed?.time || {};
  const media = normalizeWorldMedia(world);
  const characters = asArray(world?.characters);
  const personas = asArray(world?.personas);
  const scenes = asArray(world?.scenes).map(projectPublicScene);
  const systems = asArray(world?.systems).map((item) => typeof item === 'string' ? item : text(item?.name || item?.title || item?.summary, 'System'));
  const timeline = asArray(world?.timeline).length
    ? asArray(world.timeline)
    : asArray(world?.events).map((item) => text(item?.title || item?.summary, 'World event'));
  const entityKinds = asArray(world?.entityKinds).length
    ? asArray(world.entityKinds)
    : ['world', 'character', 'persona'];
  const relationshipTypes = asArray(world?.relationshipTypes).length
    ? asArray(world.relationshipTypes)
    : ['contains', 'inhabits'];
  return {
    id: text(world?.id, 'world-e2e-1'),
    name: text(world?.name, 'Fixture World'),
    summary: text(world?.summary || world?.description, 'Seeded world for desktop E2E'),
    tagline: world?.tagline ?? null,
    type: world?.type === 'OASIS' ? 'OASIS' : 'CREATOR',
    visibility: world?.visibility === 'system' ? 'system' : 'public',
    tags,
    entityKinds,
    relationshipTypes,
    media,
    time: world?.time || {
      mode: 'wallClockAnchored',
      flowRatio: Number(computedTime.flowRatio || 1),
      isPaused: computedTime.isPaused === true,
      calendar: null,
      displayFormat: null,
      anchorRealStartedAt: text(world?.createdAt, '2026-03-15T00:00:00.000Z'),
      anchorWorldStartedAt: text(world?.createdAt, '2026-03-15T00:00:00.000Z'),
      anchorWorldStartedAtDisplay: text(computedTime.eraLabel, 'Fixture Era'),
      currentWorldTime: text(computedTime.currentWorldTime, '2026-03-15T00:00:00.000Z'),
      currentWorldTimeDisplay: text(computedTime.currentLabel, 'Fixture Time'),
      computedAt: text(world?.updatedAt, '2026-03-15T00:00:00.000Z'),
    },
    stats: world?.stats || {
      characterCount: characters.length,
      personaCount: personas.length,
      sceneCount: scenes.length,
      systemCount: systems.length,
      timelineEventCount: timeline.length,
    },
    rules: asArray(world?.rules),
    systems,
    scenes,
    timeline,
    createdAt: text(world?.createdAt, '2026-03-15T00:00:00.000Z'),
    updatedAt: text(world?.updatedAt, '2026-03-15T00:00:00.000Z'),
  };
}

function projectPublicSource(world, source, sourceKind) {
  const worldId = text(world?.id, 'world-e2e-1');
  const id = text(source?.id, `${sourceKind}-fixture`);
  const sourceContentHash = explicitSourceContentHash(source, id);
  const sourceRef = {
    kind: sourceKind,
    worldId,
    sourceId: id,
    sourceContentHash,
  };
  return {
    id,
    sourceKind,
    ownership: source?.ownership ?? (sourceKind === 'worldCharacter' ? 'worldOwned' : 'userOwned'),
    ownershipType: source?.sourceOwnershipType ?? source?.ownershipType ?? (sourceKind === 'worldCharacter' ? 'WORLD_OWNED' : 'MASTER_OWNED'),
    sourceRef,
    displayName: text(source?.displayName || source?.name, id),
    handle: source?.handle ?? null,
    summary: text(source?.summary || source?.bio, 'Fixture source profile used for desktop contract coverage.'),
    role: source?.role ?? source?.archetype ?? null,
    worldId,
    worldName: text(world?.name, 'Fixture World'),
    tags: asArray(source?.tags),
    media: normalizeSourceMedia(source),
    relation: source?.relation || {
      state: 'connectable',
      connectionId: null,
    },
    updatedAt: text(source?.updatedAt || source?.createdAt || world?.updatedAt, '2026-03-15T00:00:00.000Z'),
  };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function explicitSourceContentHash(source, id) {
  const sourceRef = asRecord(source?.sourceRef);
  const candidates = [
    sourceRef && Object.prototype.hasOwnProperty.call(sourceRef, 'sourceContentHash')
      ? sourceRef.sourceContentHash
      : undefined,
    source && Object.prototype.hasOwnProperty.call(source, 'sourceContentHash')
      ? source.sourceContentHash
      : undefined,
    source && Object.prototype.hasOwnProperty.call(source, 'contentHash')
      ? source.contentHash
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate.trim();
    }
  }
  if (source?.omitContentHash === true || source?.materializationUnavailable === true) {
    return '';
  }
  return `hash-${id}`;
}

function realmCoreOrigin(value, id, contentHash) {
  const origin = asRecord(value);
  const kind = text(origin?.kind || value, 'manual');
  if (['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(kind)) {
    return {
      kind,
      sourceId: text(origin?.sourceId, id),
      sourceContentHash: text(origin?.sourceContentHash, contentHash),
      ...(origin?.parentWorldId ? { parentWorldId: String(origin.parentWorldId) } : {}),
      ...(origin?.parentCharacterId ? { parentCharacterId: String(origin.parentCharacterId) } : {}),
      ...(origin?.sourceVersion ? { sourceVersion: String(origin.sourceVersion) } : {}),
    };
  }
  return {
    kind: 'manual',
    sourceId: id,
    sourceContentHash: contentHash,
  };
}

function projectRealmPersonaCore(world, source) {
  const worldId = text(world?.id, 'world-e2e-1');
  const id = text(source?.id, 'persona-fixture');
  const contentHash = explicitSourceContentHash(source, id);
  const displayName = text(source?.displayName || source?.name, id);
  const handle = text(source?.handle, displayName);
  const summary = text(source?.summary || source?.bio, 'Fixture Realm persona used for desktop Explore materialization coverage.');
  const tags = asArray(source?.tags).map(String).filter(Boolean);
  const media = normalizeSourceMedia(source);
  const core = asRecord(source?.core) || {
    identity: {
      name: displayName,
      handle,
      summary,
    },
    presentation: {
      displayName,
      profileLine: summary,
      shortBio: summary,
      avatarResourceRef: media.avatarUrl ?? media.portraitUrl ?? null,
    },
    interactionProfile: {
      homeWorldId: worldId,
    },
    contentProfile: {
      topics: tags,
    },
    personaStyle: {
      archetype: text(source?.archetype || source?.role, 'partner'),
      voice: text(source?.voice || source?.archetype || source?.role, 'partner'),
      pacing: text(source?.pacing, 'steady'),
    },
    assets: {
      externalRefs: [
        media.avatarUrl ? { kind: 'avatar', uri: media.avatarUrl } : null,
        media.referenceImageUrl ? { kind: 'referenceImage', uri: media.referenceImageUrl } : null,
      ].filter(Boolean),
    },
  };
  const visibility = ['private', 'unlisted', 'public', 'system'].includes(source?.visibility)
    ? source.visibility
    : 'public';
  return {
    id,
    contentHash,
    contentRevision: Number.isFinite(Number(source?.contentRevision)) ? Number(source.contentRevision) : 1,
    core,
    createdAt: text(source?.createdAt || world?.createdAt, '2026-03-15T00:00:00.000Z'),
    homeWorldId: worldId,
    origin: realmCoreOrigin(source?.origin, id, contentHash),
    ownerId: text(source?.ownerId || world?.ownerId, 'user-e2e-primary'),
    schemaVersion: text(source?.schemaVersion, 'realm.persona/v1'),
    updatedAt: text(source?.updatedAt || world?.updatedAt || source?.createdAt, '2026-03-15T00:00:00.000Z'),
    visibility,
  };
}

function listRealmPersonaCores(manifest) {
  const worlds = Array.isArray(manifest.realmFixture?.worlds) ? manifest.realmFixture.worlds : [];
  return worlds.flatMap((world) => asArray(world?.personas).map((source) => projectRealmPersonaCore(world, source)));
}

function projectWorldCharacterCore(world, source) {
  const worldId = text(world?.id, 'world-e2e-1');
  const id = text(source?.id, 'character-fixture');
  const contentHash = explicitSourceContentHash(source, id);
  const displayName = text(source?.displayName || source?.name, id);
  const handle = text(source?.handle, displayName);
  const summary = text(source?.summary || source?.bio, 'Fixture world character used for desktop materialization coverage.');
  const tags = asArray(source?.tags).map(String).filter(Boolean);
  const media = normalizeSourceMedia(source);
  const entity = asRecord(source?.entity);
  const entityId = text(source?.entityId || entity?.id, `entity-${id}`);
  const core = asRecord(source?.core) || {
    identity: {
      name: displayName,
      handle,
      summary,
    },
    presentation: {
      displayName,
      profileLine: summary,
      shortBio: text(source?.bio, summary),
      avatarResourceRef: media.avatarUrl ?? media.portraitUrl ?? null,
    },
    placement: {
      worldId,
      entityId,
      role: text(source?.placement?.role || source?.role, ''),
      faction: text(source?.placement?.faction || source?.faction, ''),
      rank: text(source?.placement?.rank || source?.rank, ''),
      sceneRefs: asArray(source?.placement?.sceneRefs ?? source?.sceneRefs),
    },
    biography: asRecord(source?.biography) || { milestones: [] },
    relationships: asArray(source?.relationships),
    knowledge: asRecord(source?.knowledge) || {
      topics: tags,
      constraints: [],
    },
    interactionProfile: asRecord(source?.interactionProfile) || {},
    assets: {
      externalRefs: [
        media.avatarUrl ? { kind: 'avatar', uri: media.avatarUrl } : null,
        media.profileCoverUrl ? { kind: 'profileCover', uri: media.profileCoverUrl } : null,
        media.referenceImageUrl ? { kind: 'referenceImage', uri: media.referenceImageUrl } : null,
      ].filter(Boolean),
    },
  };
  return {
    id,
    contentHash,
    contentRevision: Number.isFinite(Number(source?.contentRevision)) ? Number(source.contentRevision) : 1,
    core,
    createdAt: text(source?.createdAt || world?.createdAt, '2026-03-15T00:00:00.000Z'),
    entityId,
    schemaVersion: text(source?.schemaVersion, 'realm.world-character-core/v1'),
    updatedAt: text(source?.updatedAt || world?.updatedAt || source?.createdAt, '2026-03-15T00:00:00.000Z'),
    worldId,
  };
}

function listWorldCharacterCores(manifest) {
  const worlds = Array.isArray(manifest.realmFixture?.worlds) ? manifest.realmFixture.worlds : [];
  return worlds.flatMap((world) => asArray(world?.characters).map((source) => projectWorldCharacterCore(world, source)));
}

function projectWorldEntityCore(world, source) {
  const worldId = text(world?.id, 'world-e2e-1');
  const id = text(source?.id, 'character-fixture');
  const displayName = text(source?.displayName || source?.name, id);
  const summary = text(source?.summary || source?.bio, 'Fixture world entity used for desktop materialization coverage.');
  const sourceEntity = asRecord(source?.entity);
  const entityId = text(source?.entityId || sourceEntity?.id, `entity-${id}`);
  const core = asRecord(sourceEntity?.core) || {
    identity: {
      name: displayName,
      kind: text(sourceEntity?.kind, 'person'),
      summary,
    },
    classification: {
      tags: asArray(source?.tags).map(String).filter(Boolean),
    },
    facts: [],
  };
  return {
    id: entityId,
    kind: text(sourceEntity?.kind, 'person'),
    worldId,
    contentHash: text(sourceEntity?.contentHash, `entity-hash-${id}`),
    core,
    createdAt: text(source?.createdAt || world?.createdAt, '2026-03-15T00:00:00.000Z'),
    updatedAt: text(source?.updatedAt || world?.updatedAt || source?.createdAt, '2026-03-15T00:00:00.000Z'),
  };
}

function listWorldEntityCores(manifest) {
  const worlds = Array.isArray(manifest.realmFixture?.worlds) ? manifest.realmFixture.worlds : [];
  return worlds.flatMap((world) => asArray(world?.characters).map((source) => projectWorldEntityCore(world, source)));
}

function projectWorldRelationshipCore(world, source, relationship, index) {
  const worldId = text(world?.id, 'world-e2e-1');
  const sourceEntity = projectWorldEntityCore(world, source);
  const type = text(relationship?.type || relationship?.relationType, 'association');
  const summary = text(relationship?.summary, '');
  const targetEntityId = text(relationship?.targetEntityId || relationship?.targetRef, `${sourceEntity.id}-${type}-${index + 1}`);
  const id = text(relationship?.id || relationship?.relationshipId, `relationship-${sourceEntity.id}-${type}-${index + 1}`);
  return {
    id,
    type,
    worldId,
    sourceEntityId: text(relationship?.sourceEntityId, sourceEntity.id),
    targetEntityId,
    contentHash: text(relationship?.contentHash, `relationship-hash-${id}`),
    core: asRecord(relationship?.core) || {
      endpoints: {
        type,
      },
      presentation: {
        title: text(relationship?.label || relationship?.targetLabel, type),
        summary,
      },
      attributes: {
        targetLabel: text(relationship?.targetLabel || relationship?.targetRef, ''),
        label: text(relationship?.label, ''),
        officeLabel: text(relationship?.officeLabel, ''),
        statusLabel: text(relationship?.statusLabel, ''),
        timeLabel: text(relationship?.timeLabel, ''),
      },
    },
  };
}

function listWorldRelationshipCores(manifest, worldIdInput, entityIdInput = '') {
  const worlds = Array.isArray(manifest.realmFixture?.worlds) ? manifest.realmFixture.worlds : [];
  const rows = [];
  for (const world of worlds) {
    const worldId = text(world?.id, '');
    if (worldIdInput && worldId !== worldIdInput) {
      continue;
    }
    for (const source of asArray(world?.characters)) {
      const sourceEntity = projectWorldEntityCore(world, source);
      const relationships = [
        ...asArray(source?.relationships),
        ...asArray(world?.relationships).filter((relationship) => text(relationship?.sourceEntityId, '') === sourceEntity.id),
      ];
      for (const [index, relationship] of relationships.entries()) {
        rows.push(projectWorldRelationshipCore(world, source, relationship, index));
      }
    }
  }
  const entityId = text(entityIdInput, '');
  return entityId ? rows.filter((row) => row.sourceEntityId === entityId || row.targetEntityId === entityId) : rows;
}

function resolveFixtureSourceHash(manifest, source) {
  const worldId = text(source?.worldId, 'world-e2e-1');
  const sourceId = text(source?.sourceId, `${source?.kind || 'source'}-fixture`);
  const world = lookupWorld(manifest, worldId);
  const collection = source?.kind === 'realmPersona' ? world?.personas : world?.characters;
  const row = asArray(collection).find((item) => String(item?.id || '') === sourceId);
  return text(row?.sourceRef?.sourceContentHash || row?.contentHash || row?.sourceContentHash, `hash-${sourceId}`);
}

function normalizeSourceRef(manifest, source) {
  const kind = text(source?.kind, '');
  const worldId = text(source?.worldId, '');
  const sourceId = text(source?.sourceId, '');
  if (!['worldCharacter', 'realmPersona'].includes(kind) || !worldId || !sourceId) {
    return null;
  }
  return {
    kind,
    worldId,
    sourceId,
    sourceContentHash: text(source?.sourceContentHash, '') || resolveFixtureSourceHash(manifest, {
      kind,
      worldId,
      sourceId,
    }),
  };
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function runtimeAccessTokenFromFixture(manifest) {
  return nullableString(manifest.tauriFixture?.runtimeDefaults?.realm?.accessToken);
}

function canonicalWorkspaceMemberships(fixture, now) {
  const realmEnvironmentId = String(fixture.realmEnvironmentId || 'realm-e2e-local');
  const defaultMembership = {
    workspaceId: String(fixture.workspaceId || 'workspace-e2e-local'),
    membershipState: 'active',
    realmEnvironmentId,
    observedAt: now,
    displayMetadata: {
      name: String(fixture.workspaceName || 'E2E Workspace'),
    },
  };
  const memberships = Array.isArray(fixture.workspaceMemberships)
    ? fixture.workspaceMemberships
    : [defaultMembership];
  return memberships.map((item) => ({
    workspace_id: String(item?.workspace_id || item?.workspaceId || defaultMembership.workspaceId),
    membership_state: String(item?.membership_state || item?.membershipState || 'active'),
    realm_environment_id: String(item?.realm_environment_id || item?.realmEnvironmentId || realmEnvironmentId),
    observed_at: String(item?.observed_at || item?.observedAt || now),
    display_metadata: item?.display_metadata || item?.displayMetadata || defaultMembership.displayMetadata,
  }));
}

function runtimeAccountTokenResponse(manifest) {
  const fixture = manifest.realmFixture || {};
  const currentUser = fixture.currentUser || {};
  const now = new Date().toISOString();
  return {
    access_token: runtimeAccessTokenFromFixture(manifest) || 'e2e-runtime-access-token',
    refresh_token: `e2e-runtime-refresh-${String(currentUser.id || 'user-e2e-primary')}`,
    token_type: 'Bearer',
    expires_in: 3600,
    account_id: String(currentUser.id || 'user-e2e-primary'),
    display_name: String(currentUser.displayName || currentUser.handle || 'E2E User'),
    realm_environment_id: String(fixture.realmEnvironmentId || 'realm-e2e-local'),
    workspace_memberships: canonicalWorkspaceMemberships(fixture, now),
  };
}

function feedItems(fixture) {
  if (Array.isArray(fixture.postFeed?.items)) {
    return fixture.postFeed.items;
  }
  if (Array.isArray(fixture.posts?.items)) {
    return fixture.posts.items;
  }
  return [];
}

function buildPostFeedResponse(fixture, requestUrl) {
  const visibility = nullableString(requestUrl.searchParams.get('visibility'));
  const worldId = nullableString(requestUrl.searchParams.get('worldId'));
  const authorId = nullableString(requestUrl.searchParams.get('authorId'));
  const cursor = nullableString(requestUrl.searchParams.get('cursor'));
  const limit = positiveInt(requestUrl.searchParams.get('limit'), 15);
  const offset = positiveInt(cursor, 0);
  const items = feedItems(fixture)
    .filter((post) => !authorId || String(post?.authorId || '') === authorId)
    .filter((post) => !worldId || String(post?.worldId || '') === worldId)
    .filter((post) => !visibility || String(post?.visibility || '') === visibility);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    page: {
      cursor,
      limit,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    },
  };
}

async function handleControl(request, response, manifestPath) {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const body = await parseBody(request);
  const manifest = readJsonFile(manifestPath);
  if (pathname === '/__fixture/control/runtime-bridge-status') {
    manifest.tauriFixture = manifest.tauriFixture || {};
    manifest.tauriFixture.runtimeBridgeStatus = {
      ...(manifest.tauriFixture.runtimeBridgeStatus || {}),
      ...(body || {}),
    };
    writeJsonFile(manifestPath, manifest);
    json(response, 200, manifest.tauriFixture.runtimeBridgeStatus);
    return;
  }
  if (pathname === '/__fixture/control/rest-online') {
    manifest.realmFixture = manifest.realmFixture || {};
    manifest.realmFixture.restOnline = body?.online !== false;
    writeJsonFile(manifestPath, manifest);
    json(response, 200, { restOnline: manifest.realmFixture.restOnline });
    return;
  }
  if (pathname === '/__fixture/control/current-user') {
    const accountId = String(body?.accountId || '').trim();
    const allowedAccountIds = Array.isArray(manifest.devKernelCheckpoint?.allowedAccountIds)
      ? manifest.devKernelCheckpoint.allowedAccountIds.map((value) => String(value || '').trim())
      : [];
    if (!accountId || !allowedAccountIds.includes(accountId)) {
      json(response, 400, { error: 'dev_kernel_account_not_allowed' });
      return;
    }
    manifest.realmFixture = manifest.realmFixture || {};
    manifest.realmFixture.currentUser = {
      ...(manifest.realmFixture.currentUser || {}),
      id: accountId,
      displayName: String(body?.displayName || accountId).trim() || accountId,
      handle: `@${accountId}`,
      email: `${accountId}@nimi.local`,
      avatarUrl: '',
    };
    writeJsonFile(manifestPath, manifest);
    json(response, 200, {
      accountId,
      displayName: manifest.realmFixture.currentUser.displayName,
    });
    return;
  }
  if (handleLocalAgentProviderControl({ body, manifest, manifestPath, pathname, response })) return;
  if (pathname === '/__fixture/control/manifest') {
    json(response, 200, manifest);
    return;
  }
  notFound(response, pathname);
}

async function handleApi(request, response, manifestPath) {
  const manifest = readJsonFile(manifestPath);
  const fixture = manifest.realmFixture || {};
  const requestUrl = new URL(request.url, 'http://127.0.0.1');
  const pathname = requestUrl.pathname;

  if (request.method === 'OPTIONS') {
    options(response);
    return undefined;
  }

  if (await handleLocalAgentProviderRequest({ manifest, manifestPath, pathname, request, response })) return undefined;

  if (pathname.startsWith('/__fixture/control/')) {
    return handleControl(request, response, manifestPath);
  }

  if (pathname === '/' || pathname === '/__fixture/health') {
    json(response, 200, {
      ok: true,
      scenarioId: manifest.scenarioId,
    });
    return undefined;
  }

  if (serveFixtureMedia(response, pathname)) {
    return undefined;
  }

  if (fixture.restOnline === false) {
    json(response, 503, {
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry_realm_request',
      retryable: true,
      message: 'fixture rest offline',
      scenarioId: manifest.scenarioId,
    });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/auth/oauth/authorize') {
    const redirect = validatedDesktopOauthRedirect(requestUrl.searchParams.get('redirect_uri'));
    const state = String(requestUrl.searchParams.get('state') || '').trim();
    const clientId = String(requestUrl.searchParams.get('client_id') || '').trim();
    const codeChallenge = String(requestUrl.searchParams.get('code_challenge') || '').trim();
    if (!redirect || !state || !clientId || !codeChallenge) {
      json(response, 400, {
        error: 'invalid_desktop_oauth_authorization_request',
      });
      return undefined;
    }
    redirect.searchParams.set('code', 'nimi-dev-kernel-fixture-code');
    redirect.searchParams.set('state', state);
    manifest.realmFixture = manifest.realmFixture || {};
    manifest.realmFixture.runtimeAccountAuthorizationRequests = [
      ...(Array.isArray(manifest.realmFixture.runtimeAccountAuthorizationRequests)
        ? manifest.realmFixture.runtimeAccountAuthorizationRequests
        : []),
      {
        clientId,
        redirectUri: redirect.origin + redirect.pathname,
        statePresent: true,
        codeChallengePresent: true,
      },
    ];
    writeJsonFile(manifestPath, manifest);
    response.statusCode = 302;
    response.setHeader('cache-control', 'no-store');
    response.setHeader('location', redirect.toString());
    response.end();
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/auth/jwks') {
    json(response, 200, fixture.authJwks || { keys: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/auth/jwks/source-materialization') {
    json(response, 200, FIXTURE_SOURCE_MATERIALIZATION_JWKS);
    return undefined;
  }

  if (request.method === 'POST' && pathname === '/api/auth/sessions/introspect') {
    json(response, 200, {
      active: true,
      revoked: false,
    });
    return undefined;
  }

  if (
    request.method === 'POST'
    && (pathname === '/api/auth/oauth/token' || pathname === '/api/auth/refresh')
  ) {
    const rawBody = await readRawBody(request);
    const form = new URLSearchParams(rawBody);
    manifest.realmFixture = manifest.realmFixture || {};
    manifest.realmFixture.runtimeAccountTokenRequests = [
      ...(Array.isArray(manifest.realmFixture.runtimeAccountTokenRequests)
        ? manifest.realmFixture.runtimeAccountTokenRequests
        : []),
      {
        path: pathname,
        contentType: String(request.headers['content-type'] || ''),
        grantType: form.get('grant_type') || null,
        clientId: form.get('client_id') || null,
        redirectUri: form.get('redirect_uri') || null,
        hasCodeVerifier: Boolean(form.get('code_verifier')),
      },
    ];
    writeJsonFile(manifestPath, manifest);
    json(response, 200, runtimeAccountTokenResponse(manifest));
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/me') {
    if (!fixture.currentUser) {
      json(response, 401, { message: 'unauthorized' });
      return undefined;
    }
    json(response, 200, fixture.currentUser);
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/chats') {
    json(response, 200, fixture.chats || { items: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/group-chats') {
    json(response, 200, fixture.groupChats || { items: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/economy/balances') {
    json(response, 200, fixture.economyBalances || {
      sparkBalance: 0,
      gemBalance: 0,
      currency: 'NIMI',
    });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/economy/subscription') {
    json(response, 200, fixture.subscription || {
      id: 'subscription-e2e-free',
      tier: 'FREE',
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      tierConfig: {
        tier: 'FREE',
        priceUsd: 0,
        features: [],
      },
    });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/notifications/unread-count') {
    json(response, 200, fixture.notificationUnreadCount || { unreadCount: 0 });
    return undefined;
  }

  const messageMatch = pathname.match(/^\/api\/human\/chats\/([^/]+)\/messages$/u);
  if (request.method === 'GET' && messageMatch) {
    const chatId = decodeURIComponent(messageMatch[1]);
    json(response, 200, fixture.messagesByChatId?.[chatId] || { items: [] });
    return undefined;
  }

  const syncMatch = pathname.match(/^\/api\/human\/chats\/([^/]+)\/sync$/u);
  if (request.method === 'GET' && syncMatch) {
    const chatId = decodeURIComponent(syncMatch[1]);
    const chats = Array.isArray(fixture.chats?.items) ? fixture.chats.items : [];
    const chat = chats.find((item) => String(item?.id || '') === chatId) || null;
    const snapshot = fixture.messagesByChatId?.[chatId] || { items: [] };
    json(response, 200, {
      events: [],
      snapshot: {
        chat,
        messages: Array.isArray(snapshot.items) ? snapshot.items : [],
      },
    });
    return undefined;
  }

  const readMatch = pathname.match(/^\/api\/human\/chats\/([^/]+)\/read$/u);
  if (request.method === 'POST' && readMatch) {
    json(response, 200, { ok: true });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/me/friends/list') {
    json(response, 200, fixture.friends || { items: [] });
    return undefined;
  }

  if (request.method === 'POST' && pathname === '/api/realm/core/source-materialization-packets') {
    const body = await parseBody(request);
    const sourceRef = normalizeSourceRef(manifest, body?.sourceRef);
    if (!sourceRef) {
      json(response, 400, { message: 'sourceRef must include kind, worldId, sourceId, and sourceContentHash' });
      return undefined;
    }
    const requestOrigin = `http://${request.headers.host}`;
    configureFixtureRealmIssuer(
      manifest.tauriFixture?.runtimeDefaults?.realm?.realmBaseUrl || requestOrigin,
    );
    const packet = createFixtureSourceMaterializationPacket({ ...body, sourceRef });
    manifest.realmFixture = manifest.realmFixture || {};
    manifest.realmFixture.sourceMaterializationPacketRequests = [
      ...(Array.isArray(manifest.realmFixture.sourceMaterializationPacketRequests)
        ? manifest.realmFixture.sourceMaterializationPacketRequests
        : []),
      {
        sourceRef,
        challengeId: text(body?.challengeId, ''),
        challengeDigest: text(body?.challengeDigest, ''),
        intendedRuntimeAudience: text(body?.intendedRuntimeAudience, ''),
        packetId: packet.packetId,
        runtimeSourceRef: `runtime-source:${sourceRef.kind}:${sourceRef.worldId}:${sourceRef.sourceId}:${sourceRef.sourceContentHash}`,
        issuedAt: packet.issuedAt,
      },
    ];
    writeJsonFile(manifestPath, manifest);
    json(response, 201, packet);
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/realm/core/personas') {
    const visibility = nullableString(requestUrl.searchParams.get('visibility'));
    const take = positiveInt(requestUrl.searchParams.get('take'), 100);
    const rows = listRealmPersonaCores(manifest)
      .filter((row) => !visibility || String(row.visibility || '').toLowerCase() === visibility.toLowerCase())
      .slice(0, take);
    json(response, 200, rows);
    return undefined;
  }

  const realmPersonaMatch = pathname.match(/^\/api\/realm\/core\/personas\/([^/]+)$/u);
  if (request.method === 'GET' && realmPersonaMatch) {
    const personaId = decodeURIComponent(realmPersonaMatch[1]);
    const row = listRealmPersonaCores(manifest).find((item) => String(item.id || '') === personaId);
    if (!row) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, row);
    return undefined;
  }

  const worldCharacterMatch = pathname.match(/^\/api\/realm\/core\/world-characters\/([^/]+)$/u);
  if (request.method === 'GET' && worldCharacterMatch) {
    const characterId = decodeURIComponent(worldCharacterMatch[1]);
    const row = listWorldCharacterCores(manifest).find((item) => String(item.id || '') === characterId);
    if (!row) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, row);
    return undefined;
  }

  const worldEntityMatch = pathname.match(/^\/api\/realm\/core\/world-entities\/([^/]+)$/u);
  if (request.method === 'GET' && worldEntityMatch) {
    const entityId = decodeURIComponent(worldEntityMatch[1]);
    const row = listWorldEntityCores(manifest).find((item) => String(item.id || '') === entityId);
    if (!row) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, row);
    return undefined;
  }

  const worldRelationshipsMatch = pathname.match(/^\/api\/realm\/core\/worlds\/([^/]+)\/relationships$/u);
  if (request.method === 'GET' && worldRelationshipsMatch) {
    const worldId = decodeURIComponent(worldRelationshipsMatch[1]);
    const entityId = requestUrl.searchParams.get('entityId') || '';
    const take = positiveInt(requestUrl.searchParams.get('take'), 500);
    json(response, 200, listWorldRelationshipCores(manifest, worldId, entityId).slice(0, take));
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/me/friends/pending') {
    json(response, 200, fixture.pendingFriends || { received: [], sent: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/me/blocks') {
    json(response, 200, fixture.blocked || { items: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/creator/characters') {
    json(response, 200, Array.isArray(fixture.creatorCharacters) ? fixture.creatorCharacters : []);
    return undefined;
  }

  const creatorCharacterMatch = pathname.match(/^\/api\/creator\/characters\/([^/]+)$/u);
  if (request.method === 'GET' && creatorCharacterMatch) {
    const character = lookupCharacter(manifest, decodeURIComponent(creatorCharacterMatch[1]));
    if (!character) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, character);
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/world') {
    json(response, 200, Array.isArray(fixture.worlds) ? fixture.worlds.map(projectPublicWorld) : []);
    return undefined;
  }

  const worldDetailMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)$/u);
  if (request.method === 'GET' && worldDetailMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldDetailMatch[1]));
    if (!world) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, projectPublicWorld(world));
    return undefined;
  }

  const worldCharactersMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/characters$/u);
  if (request.method === 'GET' && worldCharactersMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldCharactersMatch[1]));
    json(response, 200, asArray(world?.characters).map((source) => projectPublicSource(world, source, 'worldCharacter')));
    return undefined;
  }

  const worldDetailWithCharactersMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/detail-with-characters$/u);
  if (request.method === 'GET' && worldDetailWithCharactersMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldDetailWithCharactersMatch[1]));
    if (!world) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, {
      world: projectPublicWorld(world),
      sources: {
        characters: asArray(world.characters).map((source) => projectPublicSource(world, source, 'worldCharacter')),
        personas: asArray(world.personas).map((source) => projectPublicSource(world, source, 'realmPersona')),
      },
    });
    return undefined;
  }

  const worldEventsMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/events$/u);
  if (request.method === 'GET' && worldEventsMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldEventsMatch[1]));
    json(response, 200, Array.isArray(world?.events) ? world.events : []);
    return undefined;
  }

  const worldAuditsMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/level\/audits$/u);
  if (request.method === 'GET' && worldAuditsMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldAuditsMatch[1]));
    json(response, 200, Array.isArray(world?.levelAudits) ? world.levelAudits : []);
    return undefined;
  }

  const worldviewMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/worldview$/u);
  if (request.method === 'GET' && worldviewMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldviewMatch[1]));
    json(response, 200, world?.worldview || {});
    return undefined;
  }

  const worldviewEventsMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/worldview\/events$/u);
  if (request.method === 'GET' && worldviewEventsMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldviewEventsMatch[1]));
    json(response, 200, Array.isArray(world?.worldviewEvents) ? world.worldviewEvents : []);
    return undefined;
  }

  const worldviewSnapshotsMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/worldview\/snapshots$/u);
  if (request.method === 'GET' && worldviewSnapshotsMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldviewSnapshotsMatch[1]));
    json(response, 200, Array.isArray(world?.worldviewSnapshots) ? world.worldviewSnapshots : []);
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/world/posts') {
    json(response, 200, buildPostFeedResponse(fixture, requestUrl));
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/search/users') {
    json(response, 200, fixture.searchUsers || { items: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/explore') {
    json(response, 200, fixture.exploreFeed || { items: [] });
    return undefined;
  }

  const accountMatch = pathname.match(/^\/api\/human\/accounts\/([^/]+)$/u);
  if (request.method === 'GET' && accountMatch) {
    const user = lookupUser(manifest, decodeURIComponent(accountMatch[1]), 'id');
    if (!user) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, user);
    return undefined;
  }

  const handleMatch = pathname.match(/^\/api\/human\/handle\/([^/]+)$/u);
  if (request.method === 'GET' && handleMatch) {
    const user = lookupUser(manifest, decodeURIComponent(handleMatch[1]), 'handle');
    if (!user) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, user);
    return undefined;
  }

  notFound(response, pathname);
  return undefined;
}

export async function startRealmFixtureServer({ manifestPath, host = '127.0.0.1', port = 0 }) {
  const server = http.createServer((request, response) => {
    void Promise.resolve(handleApi(request, response, manifestPath)).catch((error) => {
      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
    },
    path: '/socket.io/',
    transports: ['websocket'],
  });
  io.on('connection', (socket) => {
    socket.on('chat:session.open', (payload = {}) => {
      socket.emit('chat:session.ready', {
        chatId: String(payload.chatId || '').trim(),
        sessionId: `session-${Date.now()}`,
        resumeToken: 'fixture-resume-token',
        lastAckSeq: Number(payload.lastAckSeq || 0) || 0,
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve fixture server address');
  }
  const origin = `http://${host}:${address.port}`;
  return {
    origin,
    controlUrl: `${origin}/__fixture/control`,
    async close() {
      // End fixture-owned transports before asking either server to drain.
      // A real system browser can otherwise keep the OAuth document or its
      // Socket.IO transport alive indefinitely after the Electron process has
      // already exited.
      io.disconnectSockets(true);
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        io.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          server.close((closeError) => {
            if (closeError && closeError.code !== 'ERR_SERVER_NOT_RUNNING') {
              reject(closeError);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}
