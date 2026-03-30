import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendWorldStyleSessionAnswer, canSynthesizeWorldStyleSession, createWorldStyleSession, describeWorldStyleTarget, markWorldStyleSessionSynthesized, synthesizeWorldStylePackFromSession } from './world-style-session.js';

const mockRuntime = {
  ai: {
    text: {
      generate: vi.fn(),
    },
  },
};

const textTarget = {
  key: 'text.generate::cloud::text-connector::text-model::',
  capability: 'text.generate' as const,
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'text-connector',
  connectorLabel: 'Text Connector',
  endpoint: 'https://text.example.com/v1',
  provider: 'openai',
  modelId: 'text-model',
  modelLabel: 'Text Model',
};

const localTextTarget = {
  key: 'text.generate::local::::local/qwen3-32b::qwen3-32b',
  capability: 'text.generate' as const,
  source: 'local' as const,
  route: 'local' as const,
  connectorId: '',
  connectorLabel: '',
  endpoint: '',
  provider: 'local',
  modelId: 'local/qwen3-32b',
  modelLabel: 'qwen3-32b',
  localModelId: 'qwen3-32b',
};

describe('world-style-session', () => {
  beforeEach(() => {
    mockRuntime.ai.text.generate.mockReset();
  });

  it('starts as a natural dialogue session rather than a scripted questionnaire', () => {
    const session = createWorldStyleSession('w1', 'Aurora Harbor', 'en', [
      { displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' },
    ]);

    expect(session.status).toBe('collecting');
    expect(session.operatorTurnCount).toBe(0);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]?.text).toContain('Aurora Harbor');
    expect(canSynthesizeWorldStyleSession(session)).toBe(false);
  });

  it('updates the session from one understanding-style runtime turn', async () => {
    mockRuntime.ai.text.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        assistantReply: 'That lane already feels coherent. I would only tighten what visual moves should stay off-limits.',
        readiness: 'ready_to_synthesize',
        readinessReason: 'The tone, differentiation, and palette are already stable enough to synthesize now.',
        summary: 'Aurora Harbor anchor portraits should stay grounded, role-first, and readable, with costume hierarchy doing most of the differentiation.',
        understanding: {
          tone: 'Grounded, role-first, lightly retro-futurist realism.',
          differentiation: 'Costume hierarchy, identity cues, and restrained material contrast.',
          palette: 'Restrained teal-and-brass palette with subdued backgrounds.',
          forbidden: 'No extreme close-ups or noisy cinematic backdrops.',
        },
        openQuestions: ['Do you want any world-specific taboo beyond camera and background control?'],
      }),
      finishReason: 'stop',
      trace: { traceId: 'trace-style-1' },
    });

    const session = createWorldStyleSession('w1', 'Aurora Harbor', 'en', [
      { displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' },
    ]);
    const nextSession = await appendWorldStyleSessionAnswer({
      runtime: mockRuntime as never,
      target: textTarget,
      session,
      answer: 'Keep the lane grounded and readable. Let costume hierarchy carry most of the differences.',
      agents: [{ displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' }],
    });

    expect(nextSession.status).toBe('ready_to_synthesize');
    expect(nextSession.operatorTurnCount).toBe(1);
    expect(nextSession.summary).toContain('Aurora Harbor anchor portraits');
    expect(nextSession.understanding.tone).toContain('Grounded');
    expect(nextSession.openQuestions).toEqual(['Do you want any world-specific taboo beyond camera and background control?']);
    expect(nextSession.lastTextTraceId).toBe('trace-style-1');
    expect(nextSession.messages.at(-1)?.role).toBe('assistant');
    expect(canSynthesizeWorldStyleSession(nextSession)).toBe(true);
  });

  it('retries the dialogue turn after truncation and succeeds without interrupting the operator', async () => {
    mockRuntime.ai.text.generate
      .mockResolvedValueOnce({
        text: '{"assistantReply":"still working',
        finishReason: 'length',
        trace: { traceId: 'trace-style-truncated-1' },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          assistantReply: 'The lane is coherent now. We can synthesize the style pack and still refine later if needed.',
          readiness: 'ready_to_synthesize',
          readinessReason: 'The lane already has clear tone, differentiation, palette, and taboos.',
          summary: 'Aurora Harbor anchor portraits should stay grounded, restrained, and role-first.',
          understanding: {
            tone: 'Grounded, restrained, role-first realism.',
            differentiation: 'Identity is carried by costume hierarchy and posture, not spectacle.',
            palette: 'Low-saturation teal, brass, and slate with subdued backgrounds.',
            forbidden: 'No poster lighting, no noisy effects, no extreme close-ups.',
          },
          openQuestions: [],
        }),
        finishReason: 'stop',
        trace: { traceId: 'trace-style-truncated-2' },
      });

    const session = createWorldStyleSession('w1', 'Aurora Harbor', 'en', [
      { displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' },
    ]);
    const nextSession = await appendWorldStyleSessionAnswer({
      runtime: mockRuntime as never,
      target: textTarget,
      session,
      answer: 'Keep the lane grounded and readable, with costume hierarchy doing most of the work.',
      agents: [{ displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' }],
    });

    expect(nextSession.status).toBe('ready_to_synthesize');
    expect(nextSession.lastTextTraceId).toBe('trace-style-truncated-2');
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledTimes(2);
    expect(mockRuntime.ai.text.generate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      maxTokens: 1600,
      temperature: 0.2,
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      maxTokens: 2400,
      temperature: 0.1,
    }));
  });

  it('fails closed on a structured dialogue contract error instead of retrying', async () => {
    mockRuntime.ai.text.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        readiness: 'ready_to_synthesize',
        summary: 'Aurora Harbor anchor portraits should stay grounded and readable.',
        understanding: {
          tone: 'Grounded realism.',
          differentiation: 'Costume hierarchy.',
          palette: 'Low saturation teal and brass.',
          forbidden: 'No poster lighting.',
        },
        openQuestions: [],
      }),
      finishReason: 'stop',
      trace: { traceId: 'trace-style-invalid-contract' },
    });

    const session = createWorldStyleSession('w1', 'Aurora Harbor', 'en', [
      { displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' },
    ]);

    await expect(appendWorldStyleSessionAnswer({
      runtime: mockRuntime as never,
      target: textTarget,
      session,
      answer: 'Keep the lane grounded and readable.',
      agents: [{ displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' }],
    })).rejects.toThrow('LOOKDEV_STYLE_DIALOGUE_REPLY_REQUIRED');

    expect(mockRuntime.ai.text.generate).toHaveBeenCalledTimes(1);
  });

  it('synthesizes a zh draft pack from the accumulated world-style understanding', async () => {
    mockRuntime.ai.text.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        name: '凡人修仙界 肖像风格包',
        summary: '人物锚点肖像整体克制写实，靠服装层级、身份气场和门派感拉开差异，背景始终服从角色识别。',
        visualEra: '修仙世界的人物时代感与身份气质，整体偏克制写实。',
        artStyle: '角色锚点肖像插画，强调稳定人物识别与世界观一致性。',
        paletteDirection: '克制的冷暖主色关系，背景退后，不抢角色识别。',
        materialDirection: '材质表达服务身份层级与门派差异，避免表面噪音。',
        silhouetteDirection: '全身轮廓清楚，服装结构是主要差异来源。',
        costumeDensity: '中等复杂度，优先服务身份与门派识别。',
        backgroundDirection: '背景只做世界氛围托底，不喧宾夺主。',
        promptFrame: '全身角色锚点肖像，固定焦距，稳定视角，背景服从角色识别。',
        forbiddenElements: ['极端近景', '夸张动作姿态', '喧宾夺主的背景'],
      }),
      finishReason: 'stop',
      trace: { traceId: 'trace-style-2' },
    });

    const session = markWorldStyleSessionSynthesized({
      ...createWorldStyleSession('w1', '凡人修仙界', 'zh', [
        { displayName: '韩立', concept: '低调谨慎的修士', importance: 'PRIMARY' },
      ]),
      summary: '人物锚点肖像应偏克制写实，靠服装层级、身份气场和门派感拉开差异。',
      understanding: {
        tone: '克制写实，保留修仙世界的身份气质。',
        differentiation: '靠服装层级、身份气场和门派感拉开差异。',
        palette: '配色克制，背景退后，镜头稳定。',
        forbidden: '不要极端近景、夸张动作和喧宾夺主的背景。',
      },
      operatorTurnCount: 2,
      status: 'ready_to_synthesize',
    }, '人物锚点肖像应偏克制写实，靠服装层级、身份气场和门派感拉开差异。');

    const pack = await synthesizeWorldStylePackFromSession({
      runtime: mockRuntime as never,
      target: textTarget,
      session,
      agents: [{ displayName: '韩立', concept: '低调谨慎的修士', importance: 'PRIMARY' }],
    });

    expect(pack.language).toBe('zh');
    expect(pack.seedSource).toBe('style_session');
    expect(pack.name).toBe('凡人修仙界 肖像风格包');
    expect(pack.summary).toContain('人物锚点肖像');
    expect(pack.forbiddenElements).toEqual(['极端近景', '夸张动作姿态', '喧宾夺主的背景']);
    expect(describeWorldStyleTarget('zh', textTarget)).toContain('Text Connector');
  });

  it('supports local text targets without forcing a cloud connector', async () => {
    mockRuntime.ai.text.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        assistantReply: 'The lane is coherent. I would only pin down one taboo if you want extra control.',
        readiness: 'ready_to_synthesize',
        readinessReason: 'Tone and differentiation are already stable.',
        summary: 'Aurora Harbor portraits should stay grounded and readable.',
        understanding: {
          tone: 'Grounded, readable, role-first.',
          differentiation: 'Costume hierarchy carries the separation.',
          palette: 'Restrained teal and amber.',
          forbidden: 'No extreme close-ups.',
        },
        openQuestions: [],
      }),
      finishReason: 'stop',
      trace: { traceId: 'trace-style-local' },
    });

    const session = createWorldStyleSession('w1', 'Aurora Harbor', 'en', [
      { displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' },
    ]);

    await appendWorldStyleSessionAnswer({
      runtime: mockRuntime as never,
      target: localTextTarget,
      session,
      answer: 'Keep the lane grounded and readable.',
      agents: [{ displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' }],
    });

    expect(mockRuntime.ai.text.generate).toHaveBeenLastCalledWith(expect.objectContaining({
      model: 'local/qwen3-32b',
      route: 'local',
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenLastCalledWith(expect.not.objectContaining({
      connectorId: expect.anything(),
    }));
    expect(describeWorldStyleTarget('en', localTextTarget)).toBe('Local Runtime / qwen3-32b');
  });

  it('retries style-pack synthesis after truncation and returns a validated pack', async () => {
    mockRuntime.ai.text.generate
      .mockResolvedValueOnce({
        text: '{"name":"凡人修仙界 肖像风格包"',
        finishReason: 'length',
        trace: { traceId: 'trace-pack-truncated-1' },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          name: '凡人修仙界 肖像风格包',
          summary: '人物锚点肖像整体克制写实，靠身份层级和服装结构拉开差异。',
          visualEra: '修仙人物写实时代感，强调身份与修为的内敛表达。',
          artStyle: '写实人物锚点肖像，统一世界气质，弱化宣传图感。',
          paletteDirection: '低饱和冷暖关系，背景退后，人物优先。',
          materialDirection: '布料、玉饰、金属与皮革的材质差异清楚但不过度炫技。',
          silhouetteDirection: '全身轮廓稳定清楚，结构分层优先于夸张动作。',
          costumeDensity: '中等复杂度，以身份识别为先，不堆砌装饰。',
          backgroundDirection: '背景轻环境化，只服务人物识别与世界氛围。',
          promptFrame: '全身角色锚点肖像，固定焦距，稳定视角，背景服从角色识别。',
          forbiddenElements: ['极端近景', '夸张特效', '影视海报式光效'],
        }),
        finishReason: 'stop',
        trace: { traceId: 'trace-pack-truncated-2' },
      });

    const session = markWorldStyleSessionSynthesized({
      ...createWorldStyleSession('w1', '凡人修仙界', 'zh', [
        { displayName: '韩立', concept: '低调谨慎的修士', importance: 'PRIMARY' },
      ]),
      summary: '人物锚点肖像应偏克制写实，靠身份层级和服装结构拉开差异。',
      understanding: {
        tone: '克制写实，真实、清冷、收敛。',
        differentiation: '靠身份层级、服装结构和气质差异自然体现。',
        palette: '低饱和冷暖关系，背景退后，人物优先。',
        forbidden: '不要极端近景、夸张特效和影视海报式光效。',
      },
      operatorTurnCount: 2,
      status: 'ready_to_synthesize',
    }, '人物锚点肖像应偏克制写实，靠身份层级和服装结构拉开差异。');

    const pack = await synthesizeWorldStylePackFromSession({
      runtime: mockRuntime as never,
      target: textTarget,
      session,
      agents: [{ displayName: '韩立', concept: '低调谨慎的修士', importance: 'PRIMARY' }],
    });

    expect(pack.name).toBe('凡人修仙界 肖像风格包');
    expect(pack.summary).toContain('克制写实');
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledTimes(2);
    expect(mockRuntime.ai.text.generate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      maxTokens: 2200,
      temperature: 0.1,
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      maxTokens: 3000,
      temperature: 0.05,
    }));
  });
});
