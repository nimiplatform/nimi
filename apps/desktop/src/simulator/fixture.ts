export const simulatorConformanceFixture = {
  protocol: 'nimi.simulator.module/v1',
  moduleId: 'desktop',
  catalog: {
    commandSchemas: {
      'desktop.locale.apply': {
        kind: 'object',
        properties: {
          locale: { kind: 'stringEnum', values: ['en', 'zh'] },
          lang: { kind: 'string', minLength: 1, maxLength: 32 },
          title: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
      'desktop.renderer.timer.fire': {
        kind: 'object',
        properties: {
          token: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
      'desktop.auth.begin-login': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          redirectUri: { kind: 'string', minLength: 1, maxLength: 512 },
          callbackOrigin: { kind: 'string', minLength: 1, maxLength: 256 },
          requestedScopes: {
            kind: 'array',
            items: { kind: 'string', minLength: 1, maxLength: 128 },
            maxItems: 8,
          },
          ttlSeconds: { kind: 'integer', minimum: 10, maximum: 3600 },
        },
      },
      'desktop.auth.oauth.open': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          url: { kind: 'string', minLength: 1, maxLength: 512 },
          state: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
      'desktop.auth.complete-login': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          loginAttemptId: { kind: 'string', minLength: 1, maxLength: 128 },
          code: { kind: 'string', minLength: 1, maxLength: 128 },
          state: { kind: 'string', minLength: 1, maxLength: 128 },
          nonce: { kind: 'string', minLength: 1, maxLength: 128 },
          redirectUri: { kind: 'string', minLength: 1, maxLength: 512 },
          callbackOrigin: { kind: 'string', minLength: 1, maxLength: 256 },
        },
      },
      'desktop.auth.logout': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          reason: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
      'desktop.handoff.request': {
        kind: 'object',
        properties: {
          originInstanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          targetSurfaceId: { kind: 'string', minLength: 1, maxLength: 64 },
          route: {
            kind: 'object',
            properties: {
              pathname: { kind: 'string', minLength: 1, maxLength: 512 },
              search: {
                kind: 'array',
                items: {
                  kind: 'object',
                  properties: {
                    key: { kind: 'string', minLength: 1, maxLength: 128 },
                    value: { kind: 'string', minLength: 1, maxLength: 256 },
                  },
                },
                maxItems: 8,
              },
              fragment: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', maxLength: 256 }] },
            },
          },
          card: {
            kind: 'object',
            properties: {
              title: { kind: 'string', minLength: 1, maxLength: 256 },
              detail: { kind: 'string', minLength: 1, maxLength: 1024 },
            },
          },
        },
      },
      'desktop.carry.request': {
        kind: 'object',
        properties: {
          originInstanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          carry: { kind: 'string', minLength: 1, maxLength: 512 },
          card: {
            kind: 'object',
            properties: {
              title: { kind: 'string', minLength: 1, maxLength: 256 },
              detail: { kind: 'string', minLength: 1, maxLength: 1024 },
            },
          },
        },
      },
    },
    eventSchemas: {
      'desktop.renderer.timer.fired': {
        kind: 'object',
        properties: {
          token: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
      'desktop.auth.login.pending': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          loginAttemptId: { kind: 'string', minLength: 1, maxLength: 128 },
          authorizationUrl: { kind: 'string', minLength: 1, maxLength: 512 },
          state: { kind: 'string', minLength: 1, maxLength: 128 },
          nonce: { kind: 'string', minLength: 1, maxLength: 128 },
        },
      },
      'desktop.auth.oauth.callback': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          loginAttemptId: { kind: 'string', minLength: 1, maxLength: 128 },
          code: { kind: 'string', minLength: 1, maxLength: 128 },
          state: { kind: 'string', minLength: 1, maxLength: 128 },
          redirectUri: { kind: 'string', minLength: 1, maxLength: 512 },
        },
      },
      'desktop.auth.session.authenticated': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          sessionRevision: { kind: 'integer', minimum: 1 },
          persona: {
            kind: 'object',
            properties: {
              accountId: { kind: 'string', minLength: 1, maxLength: 128 },
              userId: { kind: 'string', minLength: 1, maxLength: 128 },
              displayName: { kind: 'string', minLength: 1, maxLength: 128 },
              role: { kind: 'string', minLength: 1, maxLength: 128 },
              realmEnvironmentId: { kind: 'string', minLength: 1, maxLength: 128 },
            },
          },
          authenticatedAt: { kind: 'integer', minimum: 0 },
        },
      },
      'desktop.auth.session.anonymous': {
        kind: 'object',
        properties: {
          instanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          sessionRevision: { kind: 'integer', minimum: 1 },
        },
      },
      'desktop.handoff.requested': {
        kind: 'object',
        properties: {
          requestId: { kind: 'string', minLength: 1, maxLength: 128 },
          originInstanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          targetSurfaceId: { kind: 'string', minLength: 1, maxLength: 64 },
          route: {
            kind: 'object',
            properties: {
              pathname: { kind: 'string', minLength: 1, maxLength: 512 },
              search: {
                kind: 'array',
                items: {
                  kind: 'object',
                  properties: {
                    key: { kind: 'string', minLength: 1, maxLength: 128 },
                    value: { kind: 'string', minLength: 1, maxLength: 256 },
                  },
                },
                maxItems: 8,
              },
              fragment: { kind: 'union', variants: [{ kind: 'null' }, { kind: 'string', maxLength: 256 }] },
            },
          },
          card: {
            kind: 'object',
            properties: {
              title: { kind: 'string', minLength: 1, maxLength: 256 },
              detail: { kind: 'string', minLength: 1, maxLength: 1024 },
            },
          },
        },
      },
      'desktop.carry.requested': {
        kind: 'object',
        properties: {
          requestId: { kind: 'string', minLength: 1, maxLength: 128 },
          originInstanceId: { kind: 'string', minLength: 1, maxLength: 128 },
          carry: { kind: 'string', minLength: 1, maxLength: 512 },
          card: {
            kind: 'object',
            properties: {
              title: { kind: 'string', minLength: 1, maxLength: 256 },
              detail: { kind: 'string', minLength: 1, maxLength: 1024 },
            },
          },
        },
      },
    },
    moduleData: {
      locale: 'en',
      auth: {
        initialStatus: 'authenticated',
        persona: {
          accountId: 'sim-account-linche',
          userId: 'sim-user-linche',
          displayName: '林澈',
          role: '生态居民 · 早期体验者',
          realmEnvironmentId: 'sim-realm-env-desktop',
        },
      },
      productControl: {
        initialStatus: 'ready_for_use',
      },
      aiConfig: {
        runtimeStatus: 'unavailable',
      },
    },
  },
  lifecycle: ['prepare', 'activate', 'deactivate', 'dispose'],
} as const;
