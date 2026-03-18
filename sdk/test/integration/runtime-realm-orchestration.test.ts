import assert from 'node:assert/strict';
import test from 'node:test';

type RealmRawRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
};

type RealmGrantResponse = {
  token: string;
  version: string;
};

type RuntimeTextOutput = {
  text: string;
  trace: {
    traceId?: string;
  };
};

type RuntimeHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
};

type RuntimeMediaOutput = {
  artifacts: Array<{
    uri?: string;
    mimeType?: string;
  }>;
  trace: {
    traceId?: string;
  };
};

type RealmLike = {
  connect: () => Promise<void>;
  ready: () => Promise<void>;
  close: () => Promise<void>;
  raw: {
    request: <T>(input: RealmRawRequest) => Promise<T>;
  };
  services: {
    PostService: {
      createPost: (input: {
        content: string;
        attachments?: Array<{ uri?: string; mimeType?: string }>;
        traceId?: string;
      }) => Promise<void>;
    };
  };
};

type RuntimeLike = {
  connect: () => Promise<void>;
  ready: () => Promise<void>;
  close: () => Promise<void>;
  health: () => Promise<RuntimeHealth>;
  ai: {
    text: {
      generate: (input: {
        model: string;
        input: string;
        metadata?: Record<string, string>;
      }) => Promise<RuntimeTextOutput>;
    };
  };
  media: {
    video: {
      generate: (input: { prompt: string }) => Promise<RuntimeMediaOutput>;
    };
  };
};

async function orchestratePatternA(input: {
  realm: Pick<RealmLike, 'raw'>;
  runtime: Pick<RuntimeLike, 'ai'>;
  appId: string;
  subjectUserId: string;
  scopes: string[];
  model: string;
  prompt: string;
}): Promise<RuntimeTextOutput> {
  const grant = await input.realm.raw.request<RealmGrantResponse>({
    method: 'POST',
    path: '/api/creator/mods/control/grants/issue',
    body: {
      appId: input.appId,
      subjectUserId: input.subjectUserId,
      scopes: input.scopes,
    },
  });

  return input.runtime.ai.text.generate({
    model: input.model,
    input: input.prompt,
    metadata: {
      realmGrantToken: grant.token,
      realmGrantVersion: grant.version,
    },
  });
}

async function orchestratePatternB(input: {
  runtime: Pick<RuntimeLike, 'media'>;
  realm: Pick<RealmLike, 'services'>;
  prompt: string;
  content: string;
}): Promise<void> {
  const media = await input.runtime.media.video.generate({ prompt: input.prompt });

  await input.realm.services.PostService.createPost({
    content: input.content,
    attachments: media.artifacts.map((artifact) => ({
      uri: artifact.uri,
      mimeType: artifact.mimeType,
    })),
    traceId: media.trace.traceId,
  });
}

async function orchestratePatternC(input: {
  realm: Pick<RealmLike, 'raw'>;
  runtime: Pick<RuntimeLike, 'health'>;
  appId: string;
  subjectUserId: string;
}): Promise<void> {
  const [policy, health] = await Promise.all([
    input.realm.raw.request<{ allowed: boolean }>({
      method: 'POST',
      path: '/api/auth/policy/check',
      body: {
        appId: input.appId,
        subjectUserId: input.subjectUserId,
        action: 'ai.generate',
      },
    }),
    input.runtime.health(),
  ]);

  if (!policy.allowed) {
    throw new Error('AUTH_DENIED');
  }
  if (health.status !== 'healthy') {
    throw new Error('RUNTIME_UNAVAILABLE');
  }
}

async function orchestratePatternD(input: {
  realm: RealmLike;
  runtime: RuntimeLike;
  appId: string;
  subjectUserId: string;
  scopes: string[];
  model: string;
  prompt: string;
}): Promise<RuntimeTextOutput> {
  await input.runtime.connect();
  await input.runtime.ready();
  await input.realm.connect();
  await input.realm.ready();

  try {
    const grant = await input.realm.raw.request<RealmGrantResponse>({
      method: 'POST',
      path: '/api/creator/mods/control/grants/issue',
      body: {
        appId: input.appId,
        subjectUserId: input.subjectUserId,
        scopes: input.scopes,
      },
    });

    const output = await input.runtime.ai.text.generate({
      model: input.model,
      input: input.prompt,
      metadata: {
        realmGrantToken: grant.token,
        realmGrantVersion: grant.version,
      },
    });

    await input.realm.services.PostService.createPost({
      content: output.text,
      traceId: output.trace.traceId,
    });

    return output;
  } finally {
    await input.runtime.close();
    await input.realm.close();
  }
}

test('Pattern A: Realm -> Runtime passes grant material explicitly', async () => {
  let capturedGrantRequest: RealmRawRequest | null = null;
  let capturedGenerateInput: {
    model: string;
    input: string;
    metadata?: Record<string, string>;
  } | null = null;

  const realm = {
    raw: {
      request: async <T>(request: RealmRawRequest): Promise<T> => {
        capturedGrantRequest = request;
        return {
          token: 'grant_token_1',
          version: 'v1',
        } as T;
      },
    },
  };

  const runtime = {
    ai: {
      text: {
        generate: async (request: {
          model: string;
          input: string;
          metadata?: Record<string, string>;
        }): Promise<RuntimeTextOutput> => {
          capturedGenerateInput = request;
          return {
            text: 'pattern-a-ok',
            trace: { traceId: 'trace-a' },
          };
        },
      },
    },
  };

  const output = await orchestratePatternA({
    realm,
    runtime,
    appId: 'app.pattern.a',
    subjectUserId: 'subject-a',
    scopes: ['app.pattern.a.chat.read'],
    model: 'chat/default',
    prompt: 'hello',
  });

  assert.equal(output.text, 'pattern-a-ok');
  assert.equal(capturedGrantRequest?.path, '/api/creator/mods/control/grants/issue');
  assert.equal(capturedGenerateInput?.metadata?.realmGrantToken, 'grant_token_1');
  assert.equal(capturedGenerateInput?.metadata?.realmGrantVersion, 'v1');
});

test('Pattern B: Runtime -> Realm writes back artifacts with trace id', async () => {
  let capturedCreateInput: {
    content: string;
    attachments?: Array<{ uri?: string; mimeType?: string }>;
    traceId?: string;
  } | null = null;

  const runtime = {
    media: {
      video: {
        generate: async (): Promise<RuntimeMediaOutput> => ({
          artifacts: [{
            uri: 'nimi://artifact/video-1',
            mimeType: 'video/mp4',
          }],
          trace: {
            traceId: 'trace-b',
          },
        }),
      },
    },
  };

  const realm = {
    services: {
      PostService: {
        createPost: async (request: {
          content: string;
          attachments?: Array<{ uri?: string; mimeType?: string }>;
          traceId?: string;
        }): Promise<void> => {
          capturedCreateInput = request;
        },
      },
    },
  };

  await orchestratePatternB({
    runtime,
    realm,
    prompt: 'generate a short clip',
    content: 'video ready',
  });

  assert.equal(capturedCreateInput?.traceId, 'trace-b');
  assert.equal(capturedCreateInput?.attachments?.[0]?.uri, 'nimi://artifact/video-1');
  assert.equal(capturedCreateInput?.attachments?.[0]?.mimeType, 'video/mp4');
});

test('Pattern C: dual preflight requires both realm policy and runtime health', async () => {
  const runtimeHealthy = {
    health: async (): Promise<RuntimeHealth> => ({
      status: 'healthy',
    }),
  };
  const runtimeUnhealthy = {
    health: async (): Promise<RuntimeHealth> => ({
      status: 'unavailable',
    }),
  };

  const realmAllowed = {
    raw: {
      request: async <T>(): Promise<T> => ({ allowed: true } as T),
    },
  };
  const realmDenied = {
    raw: {
      request: async <T>(): Promise<T> => ({ allowed: false } as T),
    },
  };

  await orchestratePatternC({
    realm: realmAllowed,
    runtime: runtimeHealthy,
    appId: 'app.pattern.c',
    subjectUserId: 'subject-c',
  });

  await assert.rejects(
    async () => orchestratePatternC({
      realm: realmDenied,
      runtime: runtimeHealthy,
      appId: 'app.pattern.c',
      subjectUserId: 'subject-c',
    }),
    (error: unknown) => String((error as Error).message) === 'AUTH_DENIED',
  );

  await assert.rejects(
    async () => orchestratePatternC({
      realm: realmAllowed,
      runtime: runtimeUnhealthy,
      appId: 'app.pattern.c',
      subjectUserId: 'subject-c',
    }),
    (error: unknown) => String((error as Error).message) === 'RUNTIME_UNAVAILABLE',
  );
});

test('Pattern D: lifecycle stays independent while bridging data explicitly', async () => {
  const sequence: string[] = [];
  let capturedCreateInput: {
    content: string;
    attachments?: Array<{ uri?: string; mimeType?: string }>;
    traceId?: string;
  } | null = null;

  const realm: RealmLike = {
    connect: async () => {
      sequence.push('realm.connect');
    },
    ready: async () => {
      sequence.push('realm.ready');
    },
    close: async () => {
      sequence.push('realm.close');
    },
    raw: {
      request: async <T>(request: RealmRawRequest): Promise<T> => {
        sequence.push(`realm.raw.request:${request.path}`);
        return {
          token: 'grant_token_d',
          version: 'v-d',
        } as T;
      },
    },
    services: {
      PostService: {
        createPost: async (request: {
          content: string;
          attachments?: Array<{ uri?: string; mimeType?: string }>;
          traceId?: string;
        }): Promise<void> => {
          sequence.push('realm.services.PostService.createPost');
          capturedCreateInput = request;
        },
      },
    },
  };

  const runtime: RuntimeLike = {
    connect: async () => {
      sequence.push('runtime.connect');
    },
    ready: async () => {
      sequence.push('runtime.ready');
    },
    close: async () => {
      sequence.push('runtime.close');
    },
    health: async () => ({
      status: 'healthy',
    }),
    ai: {
      text: {
        generate: async (request): Promise<RuntimeTextOutput> => {
          sequence.push('runtime.ai.text.generate');
          assert.equal(request.metadata?.realmGrantToken, 'grant_token_d');
          assert.equal(request.metadata?.realmGrantVersion, 'v-d');
          return {
            text: 'pattern-d-output',
            trace: { traceId: 'trace-d' },
          };
        },
      },
    },
    media: {
      video: {
        generate: async () => ({
          artifacts: [],
          trace: {},
        }),
      },
    },
  };

  const output = await orchestratePatternD({
    realm,
    runtime,
    appId: 'app.pattern.d',
    subjectUserId: 'subject-d',
    scopes: ['app.pattern.d.chat.read'],
    model: 'chat/default',
    prompt: 'hello d',
  });

  assert.equal(output.text, 'pattern-d-output');
  assert.equal(capturedCreateInput?.traceId, 'trace-d');
  assert.deepEqual(sequence, [
    'runtime.connect',
    'runtime.ready',
    'realm.connect',
    'realm.ready',
    'realm.raw.request:/api/creator/mods/control/grants/issue',
    'runtime.ai.text.generate',
    'realm.services.PostService.createPost',
    'runtime.close',
    'realm.close',
  ]);
});
