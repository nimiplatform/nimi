import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorldInputProjection,
  createInspectWorldRenderPlan,
  createInspectWorldSession,
  createWorldFacade,
  normalizeWorldFixturePackage,
  projectWorldRuntimePayload,
  normalizeWorldTruthListItem,
  normalizeWorldTruthDetail,
} from '../../src/world/index.js';

test('world.generate projection and runtime input stay projection-first', () => {
  const projection = buildWorldInputProjection({
    worldId: 'world-1',
    displayName: 'Harbor District',
    textPrompt: 'A calm harbor with layered bridges.',
    worldSummary: 'A coastal district built for inspection.',
    spatialSummary: 'Tiered streets around a central marina.',
    moodStyleHints: ['soft afternoon light'],
    tags: ['harbor', 'inspect'],
    conditioning: {
      type: 'image',
      content: {
        kind: 'uri',
        uri: 'https://example.com/reference.png',
      },
    },
  });

  assert.deepEqual(projection.sourceModalities, ['text', 'image']);

  const request = createWorldFacade({
    appId: 'nimi.world.test',
    runtime: {
      media: {
        jobs: {
          submit: async (input: unknown) => input,
        },
      },
    },
    domains: {
      world: {
        getWorld: async () => ({ id: 'world-1' }),
        getWorldview: async () => ({ id: 'world-1' }),
      },
    },
  } as any).generate.toRuntimeInput(projection, { model: 'marble-1.1' });

  assert.equal(request.model, 'marble-1.1');
  assert.match(String(request.textPrompt || ''), /World summary:/);
  assert.equal(request.conditioning?.type, 'image');
});

test('world fixture normalization drives inspect render and session helpers', () => {
  const fixture = normalizeWorldFixturePackage({
    manifestPath: '/tmp/world/fixture-manifest.json',
    worldId: 'world-1',
    displayName: 'Harbor District',
    thumbnailLocalPath: '/tmp/world/preview.png',
    spzLocalPath: '/tmp/world/world.spz',
    spzUrls: {
      cached: 'https://example.com/world.spz',
    },
    viewerPreset: {
      version: 1,
      mode: 'inspect',
      source: 'manual',
      camera: {
        position: { x: 1, y: 2, z: 3 },
        target: { x: 4, y: 5, z: 6 },
      },
    },
  });

  assert.ok(fixture);
  const renderPlan = createInspectWorldRenderPlan(fixture);
  assert.ok(renderPlan);
  assert.equal(renderPlan?.mode, 'inspect');
  assert.equal(renderPlan?.spzLocalPath, '/tmp/world/world.spz');
  assert.equal(renderPlan?.initialCameraPolicy.source, 'fixture_preset');

  const session = createInspectWorldSession({
    fixture,
    renderPlan,
  });
  assert.equal(session.mode, 'inspect');
  assert.equal(session.lifecycle, 'ready');
  assert.match(session.sessionId, /inspect:/);
});

test('world facade binds truth and generate helpers to a platform client', async () => {
  const calls: Array<[string, unknown]> = [];
  const facade = createWorldFacade({
    appId: 'nimi.world.test',
    runtime: {
      media: {
        jobs: {
          submit: async (input: unknown) => {
            calls.push(['generate', input]);
            return { jobId: 'job-1' };
          },
        },
      },
    },
    domains: {
      world: {
        listWorlds: async () => {
          calls.push(['listWorlds', null]);
          return [
            {
              id: 'world-1',
              name: 'Harbor District',
              description: 'Canonical harbor.',
              status: 'ACTIVE',
              type: 'CREATOR',
              bannerUrl: 'https://example.com/world-1.png',
              computed: {
                score: {
                  scoreEwma: 88,
                },
              },
            },
          ];
        },
        getWorld: async (worldId: string) => {
          calls.push(['getWorld', worldId]);
          return { id: worldId, title: 'Harbor District', summary: 'Canonical harbor.' };
        },
        getWorldview: async (worldId: string) => {
          calls.push(['getWorldview', worldId]);
          return {
            id: worldId,
            lifecycle: 'ACTIVE',
            version: 3,
            truthRules: [{ id: 'rule-1' }],
            languages: { languages: [{ name: 'Harbor Cant' }] },
            locations: { regions: [{ name: 'Marina Ring' }], landmarks: [{ name: 'Bridge Gate' }] },
          };
        },
        getWorldDetailWithAgents: async (worldId: string, recommendedAgentLimit = 4) => {
          calls.push(['getWorldDetailWithAgents', { worldId, recommendedAgentLimit }]);
          return {
            id: worldId,
            name: 'Harbor District',
            description: 'Canonical harbor.',
            overview: 'A layered harbor with civic walkways.',
            status: 'ACTIVE',
            type: 'CREATOR',
            level: 7,
            agentCount: 2,
            contentRating: 'PG13',
            nativeCreationState: 'OPEN',
            createdAt: '2026-04-18T00:00:00Z',
            updatedAt: '2026-04-18T01:00:00Z',
            computed: {
              featuredAgentCount: 1,
              entry: {
                recommendedAgents: [
                  {
                    id: 'agent-1',
                    name: 'Maris',
                    handle: 'maris',
                    importance: 'PRIMARY',
                    avatarUrl: 'https://example.com/maris.png',
                    display: {
                      role: 'Harbor Guide',
                      faction: 'Dock Wardens',
                      location: 'South Marina',
                      statusSummary: 'On duty',
                    },
                  },
                ],
              },
            },
          };
        },
      },
    },
  } as any);

  const truthList = await facade.truth.list();
  assert.equal(truthList[0]?.worldId, 'world-1');
  assert.equal(truthList[0]?.bannerUrl, 'https://example.com/world-1.png');
  assert.equal(truthList[0]?.computed?.score?.scoreEwma, 88);

  const truthSummary = await facade.truth.read('world-1');
  assert.equal(truthSummary.worldId, 'world-1');
  assert.equal(truthSummary.title, 'Harbor District');
  assert.equal(truthSummary.worldview?.version, 3);
  assert.equal(truthSummary.worldview?.truthRuleCount, 1);

  const truthDetail = await facade.truth.readDetail('world-1');
  assert.equal(truthDetail.level, 7);
  assert.equal(truthDetail.recommendedAgents?.[0]?.name, 'Maris');

  const submitted = await facade.generate.submit({
    model: 'marble-1.1',
    textPrompt: 'A layered harbor scene.',
  });
  assert.equal(submitted.job.jobId, 'job-1');
  assert.equal(calls[0]?.[0], 'listWorlds');
  assert.equal(calls[1]?.[0], 'getWorld');
  assert.equal(calls[3]?.[0], 'getWorldDetailWithAgents');
  assert.equal(calls[4]?.[0], 'getWorldview');
  assert.equal(calls[5]?.[0], 'generate');
});

test('world projection facade binds runtime projection requests to the realm service', async () => {
  const calls: Array<[string, unknown]> = [];
  const client = {
    realm: {
      services: {
        RuntimeProjectionsService: {
          projectRuntimePayload: async (input: unknown) => {
            calls.push(['projectRuntimePayload', input]);
            return {
              worldId: 'world-1',
              agentId: 'agent-1',
              consumerSurface: 'RUNTIME_PAYLOAD',
              releaseAnchor: 'release-1',
              checksum: 'checksum-1',
              selectedInputs: [
                {
                  id: 'input-1',
                  sourceType: 'WORLD_RULE',
                  sourceId: 'rule-1',
                  lineageId: 'lineage-1',
                  worldId: 'world-1',
                  ruleKey: 'harbor.layout',
                  title: 'Harbor Layout',
                  statement: 'Keep the layered harbor readable.',
                  hardness: 'HARD',
                  priority: 10,
                  scope: 'WORLD',
                  provenance: 'world.truth',
                },
              ],
              trace: {
                selectedInputIds: ['input-1'],
                suppressedInputs: [],
                resolutionOutcomes: [
                  {
                    inputId: 'input-1',
                    sourceType: 'WORLD_RULE',
                    decision: 'SELECTED',
                    reasons: ['scope-match'],
                  },
                ],
              },
              payload: {
                worldRules: [
                  {
                    id: 'input-1',
                    sourceType: 'WORLD_RULE',
                    sourceId: 'rule-1',
                    lineageId: 'lineage-1',
                    worldId: 'world-1',
                    ruleKey: 'harbor.layout',
                    title: 'Harbor Layout',
                    statement: 'Keep the layered harbor readable.',
                    hardness: 'HARD',
                    priority: 10,
                    scope: 'WORLD',
                    provenance: 'world.truth',
                  },
                ],
                agentRules: [],
              },
            };
          },
        },
      },
    },
  } as any;

  const result = await projectWorldRuntimePayload(client, {
    worldId: 'world-1',
    agentId: 'agent-1',
    releaseAnchor: 'release-1',
    contextEnvelope: {
      sceneId: 'scene-1',
      focusKeywords: ['harbor'],
      allowedAgentLayers: ['BEHAVIORAL'],
    },
  });

  assert.deepEqual(calls, [[
    'projectRuntimePayload',
    {
      worldId: 'world-1',
      agentId: 'agent-1',
      releaseAnchor: 'release-1',
      contextEnvelope: {
        sceneId: 'scene-1',
        focusKeywords: ['harbor'],
        allowedAgentLayers: ['BEHAVIORAL'],
      },
    },
  ]]);
  assert.equal(result.checksum, 'checksum-1');
  assert.equal(result.trace.resolutionOutcomes[0]?.decision, 'SELECTED');
  assert.equal(result.payload.worldRules[0]?.ruleKey, 'harbor.layout');

  const facade = createWorldFacade(client);
  const facadeResult = await facade.projection.projectRuntimePayload({
    worldId: 'world-1',
  });
  assert.equal(facadeResult.consumerSurface, 'RUNTIME_PAYLOAD');
  assert.equal(calls.length, 2);
});

test('world truth detail normalizes a bounded composed detail shape', () => {
  const detail = normalizeWorldTruthDetail({
    detail: {
      id: 'world-1',
      name: 'Harbor District',
      description: 'Canonical harbor.',
      overview: 'A layered harbor with civic walkways.',
      status: 'ACTIVE',
      type: 'CREATOR',
      contentRating: 'PG13',
      nativeCreationState: 'OPEN',
      agentCount: 2,
      level: 7,
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T01:00:00Z',
      computed: {
        featuredAgentCount: 1,
        entry: {
          recommendedAgents: [
            {
              id: 'agent-1',
              name: 'Maris',
              importance: 'PRIMARY',
              handle: 'maris',
              display: {
                role: 'Harbor Guide',
              },
            },
          ],
        },
      },
    },
    worldview: {
      worldId: 'world-1',
      lifecycle: 'ACTIVE',
      version: 3,
      updatedAt: '2026-04-18T02:00:00Z',
      truthRules: [{ id: 'rule-1' }, { id: 'rule-2' }],
      languages: { languages: [{ name: 'Harbor Cant' }] },
      locations: { regions: [{ name: 'Marina Ring' }], landmarks: [{ name: 'Bridge Gate' }] },
      visualGuide: {},
    },
  });

  assert.ok(detail);
  assert.equal(detail.worldId, 'world-1');
  assert.equal(detail.status, 'ACTIVE');
  assert.equal(detail.contentRating, 'PG13');
  assert.equal(detail.worldview?.truthRuleCount, 2);
  assert.equal(detail.recommendedAgents?.[0]?.role, 'Harbor Guide');
});

test('world truth list normalizes a bounded shared-discovery shape', () => {
  const listItem = normalizeWorldTruthListItem({
    id: 'world-1',
    name: 'Harbor District',
    description: 'Canonical harbor.',
    tagline: 'Layered civic harbor.',
    status: 'ACTIVE',
    type: 'CREATOR',
    bannerUrl: 'https://example.com/world-1.png',
    iconUrl: 'https://example.com/world-1-icon.png',
    agentCount: 12,
    nativeCreationState: 'OPEN',
    genre: 'Urban fantasy',
    era: 'Late Summer',
    themes: ['harbor', 'civic'],
    scoreEwma: 88,
    computed: {
      time: {
        currentLabel: 'Late Summer',
        flowRatio: 1.25,
      },
      languages: {
        primary: 'Harbor Cant',
        common: ['Harbor Cant', 'Trade Tongue'],
      },
      entry: {
        recommendedAgents: [
          {
            id: 'agent-1',
            name: 'Maris',
            handle: 'maris',
            avatarUrl: 'https://example.com/maris.png',
          },
        ],
      },
      score: {
        scoreEwma: 88,
      },
      featuredAgentCount: 2,
    },
  });

  assert.equal(listItem?.worldId, 'world-1');
  assert.equal(listItem?.bannerUrl, 'https://example.com/world-1.png');
  assert.equal(listItem?.computed?.time?.currentLabel, 'Late Summer');
  assert.equal(listItem?.computed?.entry?.recommendedAgents?.[0]?.name, 'Maris');
});
