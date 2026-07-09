import {
  DISABLED_CHARACTER_ID,
  OWNER_USER_ID,
  VALID_CHARACTER_ID,
  VALID_SOURCE_REF,
} from './acceptance-constants.mjs';

function mediaUrl(mediaOrigin, name) {
  return `${mediaOrigin}/__fixture/media/${name}.svg`;
}

function audioUrl(mediaOrigin, name) {
  return `${mediaOrigin}/__fixture/media/${name}.wav`;
}

export function createRealmFixtureManifest(origin, mediaOrigin = origin) {
  const avatarUrl = mediaUrl(mediaOrigin, 'yan-zhenqing-avatar');
  const profileCoverUrl = mediaUrl(mediaOrigin, 'yan-zhenqing-cover');
  const referenceImageUrl = mediaUrl(mediaOrigin, 'yan-zhenqing-reference');
  const voiceSampleUrl = audioUrl(mediaOrigin, 'yan-zhenqing-voice');
  return {
    scenarioId: 'desktop.explore.world-character-materialization.acceptance',
    realmFixture: {
      restOnline: true,
      currentUser: {
        id: OWNER_USER_ID,
        displayName: '验收用户',
        handle: '@acceptance-user',
        email: 'acceptance@nimi.local',
        avatarUrl: '',
      },
      chats: { items: [] },
      messagesByChatId: {},
      groupChats: { items: [] },
      economyBalances: { sparkBalance: 0, gemBalance: 0, currency: 'NIMI' },
      subscription: {
        id: 'subscription-acceptance-free',
        tier: 'FREE',
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        tierConfig: { tier: 'FREE', priceUsd: 0, features: [] },
      },
      notificationUnreadCount: { unreadCount: 0 },
      friends: { items: [] },
      pendingFriends: { received: [], sent: [] },
      blocked: { items: [] },
      creatorCharacters: [],
      worlds: [{
        id: VALID_SOURCE_REF.worldId,
        name: '唐代书法与忠臣世界',
        summary: '围绕唐代书法、朝堂风骨与安史之乱人物关系的验收世界。',
        description: '这个世界用于验证 Desktop worldCharacter materialization 的真实链路：从世界人物进入完整人物页，创建 Runtime LocalAgent，再回到聊天时保留头像、人物设定和世界语境。',
        visibility: 'system',
        tags: ['唐代', '书法', '人物关系'],
        media: {
          iconUrl: mediaUrl(mediaOrigin, 'tang-world-icon'),
          bannerUrl: mediaUrl(mediaOrigin, 'tang-world-banner'),
          heroUrl: mediaUrl(mediaOrigin, 'tang-world-hero'),
          highlightUrls: [mediaUrl(mediaOrigin, 'tang-world-highlight')],
        },
        stats: {
          characterCount: 2,
          personaCount: 0,
          sceneCount: 1,
          systemCount: 1,
          timelineEventCount: 2,
        },
        rules: ['Materialization must be Runtime-mediated and source-backed.'],
        systems: ['唐代朝堂与书法声望系统'],
        scenes: [{
          sceneId: 'tang-court-tent',
          name: '军帐与朝堂之间',
          summary: '颜真卿在战乱与朝政之间维持秩序、忠义和书法风骨。',
          media: [],
          activeEntities: [],
          relatedCharacters: [VALID_CHARACTER_ID],
          relatedEvents: [],
          relatedResources: [],
          counts: {
            activeEntityCount: 0,
            relatedCharacterCount: 1,
            relatedEventCount: 0,
            relatedResourceCount: 0,
          },
        }],
        timeline: ['颜真卿登进士第', '安史之乱中起兵抗叛'],
        type: 'OASIS',
        status: 'DISCOVERABLE',
        createdAt: '2026-03-15T00:00:00.000Z',
        updatedAt: '2026-03-15T00:00:00.000Z',
        computed: {
          time: {
            currentWorldTime: '0756-01-01T00:00:00.000Z',
            currentLabel: '安史之乱初期',
            eraLabel: '唐代',
            flowRatio: 1,
            isPaused: false,
          },
          score: { scoreEwma: 94 },
          featuredCharacterCount: 1,
          entry: {
            recommendedCharacters: [{
              id: VALID_CHARACTER_ID,
              name: '颜真卿',
              handle: '~yan-zhenqing',
              avatarUrl,
            }],
          },
        },
        characters: [{
          id: VALID_CHARACTER_ID,
          worldId: VALID_SOURCE_REF.worldId,
          sourceKind: 'worldCharacter',
          sourceRef: VALID_SOURCE_REF,
          contentHash: VALID_SOURCE_REF.sourceContentHash,
          displayName: '颜真卿',
          name: '颜真卿',
          handle: '~yan-zhenqing',
          summary: '颜真卿，字清臣，唐代著名书法家、忠臣、政治家。安史之乱中，他坚守平原郡，起兵抗叛，后官至太师，封鲁郡公。',
          bio: '唐代书法家、忠臣、政治家，字清臣。',
          role: '书法家、忠臣、政治家',
          sourceOwnershipType: 'WORLD_OWNED',
          importance: 'PRIMARY',
          tags: ['唐代', '书法家', '忠臣'],
          media: {
            avatarUrl,
            profileCoverUrl,
            referenceImageUrl,
            voiceSampleUrl,
          },
          entity: {
            id: 'entity-yan-zhenqing',
            kind: 'person',
            contentHash: 'entity-yan-zhenqing-hash',
            core: {
              identity: {
                name: '颜真卿',
                kind: 'person',
                summary: '唐代书法家、忠臣、政治家。',
              },
              classification: {
                tags: ['书法', '唐代士族', '安史之乱'],
              },
              facts: [{
                key: 'courtesyName',
                label: '字',
                value: '清臣',
              }, {
                key: 'posthumousTitle',
                label: '谥号',
                value: '文忠',
              }],
            },
          },
          placement: {
            worldId: VALID_SOURCE_REF.worldId,
            entityId: 'entity-yan-zhenqing',
            role: '书法家、忠臣、政治家',
            faction: '唐代士族、书法大家',
            rank: '太师、鲁郡公',
            sceneRefs: ['tang-court-tent'],
          },
          biography: {
            milestones: [{
              milestoneId: 'yan-zhenqing-milestone-jinshi',
              title: '开元二十二年登进士第',
              summary: '颜真卿登进士第，进入唐代官僚体系。',
              sequence: 1,
              timeLabel: '734',
            }, {
              milestoneId: 'yan-zhenqing-milestone-anshi',
              title: '安史之乱中起兵抗叛',
              summary: '安史之乱爆发后，颜真卿坚守平原郡并联络诸郡抗叛。',
              sequence: 2,
              timeLabel: '755',
            }],
          },
          relationships: [{
            targetRef: 'status-loyal-minister',
            relationType: 'status',
            summary: '颜真卿在唐代政治史中以忠烈形象著称。',
          }, {
            targetRef: 'work-yan-qinli-stele',
            relationType: 'text',
            summary: '《颜勤礼碑》体现其楷书风格。',
          }],
          knowledge: {
            topics: ['书法风格', '安史之乱', '唐代朝政', '忠义与仕途'],
            constraints: ['保持唐代士大夫语境', '回答时区分史实与演绎'],
          },
          interactionProfile: {
            tone: '沉稳刚正，带有唐代重臣的克制与威严。',
            cadence: '语速平缓，句式有力，先辨义理再讲事实。',
            scenario: '军帐、朝堂与书斋之间的对话。',
            greeting: '老夫颜真卿，字清臣。你欲问书法、仕途，还是安史之乱？',
            greetingVariants: [
              '想问书法、仕途还是安史之乱？',
              '若问忠义，先问人心；若问书法，先问筋骨。',
            ],
            dialogueExemplars: [
              '书法不止笔画，亦是立身之法。',
              '乱世之中，文臣也须知守土与担当。',
            ],
          },
          relation: { state: 'connectable', connectionId: null },
          createdAt: '2026-03-15T00:00:00.000Z',
          updatedAt: '2026-03-15T00:00:00.000Z',
        }, {
          id: DISABLED_CHARACTER_ID,
          worldId: VALID_SOURCE_REF.worldId,
          sourceKind: 'worldCharacter',
          sourceRef: {
            kind: 'worldCharacter',
            worldId: VALID_SOURCE_REF.worldId,
            sourceId: DISABLED_CHARACTER_ID,
            sourceContentHash: 'character-acceptance-disabled-hash',
          },
          contentHash: 'character-acceptance-disabled-hash',
          materializationUnavailable: true,
          displayName: '不可创建本地伙伴的人物候选',
          name: '不可创建本地伙伴的人物候选',
          handle: '~missing-hash-character',
          summary: '这个 worldCharacter 保持完整 sourceRef，但用不可连接的关系状态验证 CTA fail-closed disabled 状态。',
          bio: '有完整 sourceRef 但当前不可 materialize 的人物候选。',
          role: '不可 materialize 的候选',
          sourceOwnershipType: 'WORLD_OWNED',
          importance: 'SECONDARY',
          tags: ['失败态', '禁用态'],
          relation: { state: 'unavailable', connectionId: null },
          createdAt: '2026-03-15T00:00:00.000Z',
          updatedAt: '2026-03-15T00:00:00.000Z',
        }],
        personas: [],
        events: [],
        levelAudits: [],
        worldview: {},
        worldviewEvents: [],
        worldviewSnapshots: [],
      }],
      searchUsers: { items: [] },
      exploreFeed: { items: [] },
      postFeed: { items: [] },
    },
    tauriFixture: {
      runtimeDefaults: {
        realm: {
          realmBaseUrl: origin,
          realtimeUrl: origin,
          accessToken: 'desktop-acceptance-access-token',
          jwksUrl: `${origin}/api/auth/jwks`,
          revocationUrl: `${origin}/api/auth/sessions/introspect`,
          jwtIssuer: origin,
          jwtAudience: 'nimi-runtime',
        },
      },
    },
  };
}
