import type {
  DesktopSimulatorBehaviorContext,
  DesktopSimulatorCommandEnvelope,
  DesktopSimulatorInitialInput,
  DesktopSimulatorJsonValue,
  DesktopSimulatorProjectionInput,
} from './protocol.js';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

type AuthPersona = {
  readonly accountId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly role: string;
  readonly realmEnvironmentId: string;
};

type AuthStatus = 'anonymous' | 'login-pending' | 'authenticated';

type AuthSession = {
  readonly status: AuthStatus;
  readonly loginAttemptId: string | null;
  readonly oauthState: string | null;
  readonly oauthNonce: string | null;
  readonly oauthCode: string | null;
  readonly redirectUri: string | null;
  readonly callbackOrigin: string | null;
  readonly authorizationUrl: string | null;
  readonly authenticatedAt: number | null;
};

type AuthState = {
  readonly persona: AuthPersona;
  readonly initialStatus: Extract<AuthStatus, 'anonymous' | 'authenticated'>;
  readonly sessions: Readonly<Record<string, AuthSession>>;
  readonly attemptSequence: number;
  readonly sessionRevision: number;
};

type Reduction = {
  readonly state: JsonRecord;
  readonly events: readonly {
    readonly type: string;
    readonly payload: JsonRecord;
  }[];
};

function record(value: DesktopSimulatorJsonValue | undefined, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function text(value: DesktopSimulatorJsonValue | undefined, label: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value;
}

function optionalText(value: DesktopSimulatorJsonValue | undefined, label: string): string | null {
  if (value === null) return null;
  return text(value, label, 512);
}

function optionalTime(value: DesktopSimulatorJsonValue | undefined, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value;
}

function personaFrom(value: DesktopSimulatorJsonValue | undefined): AuthPersona {
  const candidate = record(value ?? null, 'AUTH_PERSONA');
  const accountId = text(candidate.accountId, 'AUTH_PERSONA', 128);
  const userId = text(candidate.userId, 'AUTH_PERSONA', 128);
  const realmEnvironmentId = text(candidate.realmEnvironmentId, 'AUTH_PERSONA', 128);
  if (![accountId, userId, realmEnvironmentId].every((value) => value.startsWith('sim-'))) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_PERSONA_INVALID');
  }
  return Object.freeze({
    accountId,
    userId,
    displayName: text(candidate.displayName, 'AUTH_PERSONA', 128),
    role: text(candidate.role, 'AUTH_PERSONA', 128),
    realmEnvironmentId,
  });
}

function sessionFrom(value: DesktopSimulatorJsonValue | undefined): AuthSession {
  const candidate = record(value ?? null, 'AUTH_SESSION');
  const status = candidate.status;
  if (status !== 'anonymous' && status !== 'login-pending' && status !== 'authenticated') {
    throw new Error('DESKTOP_SIMULATOR_AUTH_SESSION_INVALID');
  }
  const session: AuthSession = {
    status,
    loginAttemptId: optionalText(candidate.loginAttemptId, 'AUTH_SESSION'),
    oauthState: optionalText(candidate.oauthState, 'AUTH_SESSION'),
    oauthNonce: optionalText(candidate.oauthNonce, 'AUTH_SESSION'),
    oauthCode: optionalText(candidate.oauthCode, 'AUTH_SESSION'),
    redirectUri: optionalText(candidate.redirectUri, 'AUTH_SESSION'),
    callbackOrigin: optionalText(candidate.callbackOrigin, 'AUTH_SESSION'),
    authorizationUrl: optionalText(candidate.authorizationUrl, 'AUTH_SESSION'),
    authenticatedAt: optionalTime(candidate.authenticatedAt, 'AUTH_SESSION'),
  };
  const pendingFields = [
    session.loginAttemptId,
    session.oauthState,
    session.oauthNonce,
    session.oauthCode,
    session.redirectUri,
    session.callbackOrigin,
    session.authorizationUrl,
  ];
  if ((status === 'login-pending' && pendingFields.some((field) => field === null))
    || (status !== 'login-pending' && pendingFields.some((field) => field !== null))
    || (status !== 'authenticated' && session.authenticatedAt !== null)) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_SESSION_INVALID');
  }
  return session;
}

function anonymousSession(): AuthSession {
  return {
    status: 'anonymous',
    loginAttemptId: null,
    oauthState: null,
    oauthNonce: null,
    oauthCode: null,
    redirectUri: null,
    callbackOrigin: null,
    authorizationUrl: null,
    authenticatedAt: null,
  };
}

function defaultSession(status: AuthState['initialStatus']): AuthSession {
  return status === 'authenticated'
    ? { ...anonymousSession(), status: 'authenticated' }
    : anonymousSession();
}

function sessionFor(auth: AuthState, instanceId: string): AuthSession {
  return auth.sessions[instanceId] ?? defaultSession(auth.initialStatus);
}

function authSlice(value: DesktopSimulatorJsonValue): AuthState {
  const auth = record(value, 'AUTH');
  const persona = personaFrom(auth.persona);
  const sessionsValue = record(auth.sessions, 'AUTH_SESSIONS');
  const sessions: Record<string, AuthSession> = {};
  for (const [instanceId, session] of Object.entries(sessionsValue)) {
    sessions[instanceId] = sessionFrom(session);
  }
  if ((auth.initialStatus !== 'anonymous' && auth.initialStatus !== 'authenticated')
    || !Number.isSafeInteger(auth.attemptSequence)
    || !Number.isSafeInteger(auth.sessionRevision)) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_INVALID');
  }
  return {
    persona,
    initialStatus: auth.initialStatus,
    sessions,
    attemptSequence: auth.attemptSequence as number,
    sessionRevision: auth.sessionRevision as number,
  };
}

function state(value: DesktopSimulatorJsonValue): JsonRecord {
  const candidate = record(value, 'STATE');
  if (candidate.protocolRevision !== 1 || typeof candidate.locale !== 'string') {
    throw new Error('DESKTOP_SIMULATOR_STATE_INVALID');
  }
  authSlice(candidate.auth ?? null);
  const productControl = record(candidate.productControl ?? null, 'PRODUCT_CONTROL');
  if (productControl.status !== 'ready_for_use') {
    throw new Error('DESKTOP_SIMULATOR_PRODUCT_CONTROL_INVALID');
  }
  const aiConfig = record(candidate.aiConfig ?? null, 'AI_CONFIG');
  if (aiConfig.runtimeStatus !== 'unavailable') {
    throw new Error('DESKTOP_SIMULATOR_AI_CONFIG_INVALID');
  }
  productRequests(candidate.productRequests ?? null);
  return candidate;
}

const MAX_PRODUCT_REQUEST_LOG = 16;

interface ProductRequestLog {
  readonly sequence: number;
  readonly log: readonly JsonRecord[];
}

function productRequests(value: DesktopSimulatorJsonValue): ProductRequestLog {
  const candidate = record(value, 'PRODUCT_REQUESTS');
  if (!Number.isSafeInteger(candidate.sequence) || !Array.isArray(candidate.log)) {
    throw new Error('DESKTOP_SIMULATOR_PRODUCT_REQUESTS_INVALID');
  }
  return candidate as unknown as ProductRequestLog;
}

function routePayload(value: DesktopSimulatorJsonValue | undefined): JsonRecord {
  const route = record(value, 'HANDOFF_ROUTE');
  const pathname = text(route.pathname, 'HANDOFF_ROUTE', 512);
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    throw new Error('DESKTOP_SIMULATOR_HANDOFF_ROUTE_INVALID');
  }
  if (!Array.isArray(route.search) || route.search.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
    const pair = entry as JsonRecord;
    return typeof pair.key !== 'string' || typeof pair.value !== 'string';
  })) {
    throw new Error('DESKTOP_SIMULATOR_HANDOFF_ROUTE_INVALID');
  }
  if (route.fragment !== null && typeof route.fragment !== 'string') {
    throw new Error('DESKTOP_SIMULATOR_HANDOFF_ROUTE_INVALID');
  }
  return route;
}

function cardPayload(value: DesktopSimulatorJsonValue | undefined): JsonRecord {
  const card = record(value, 'REQUEST_CARD');
  return {
    title: text(card.title, 'REQUEST_CARD', 256),
    detail: text(card.detail, 'REQUEST_CARD', 1024),
  };
}

function reduceProductRequest(
  current: JsonRecord,
  payload: JsonRecord,
  context: DesktopSimulatorBehaviorContext,
  kind: 'handoff' | 'carry',
): Reduction {
  const requests = productRequests(current.productRequests ?? null);
  const originInstanceId = text(payload.originInstanceId, 'REQUEST_ORIGIN', 128);
  const sequence = requests.sequence + 1;
  const requestId = `sim-${kind}-${sequence}`;
  const request: JsonRecord = kind === 'handoff'
    ? {
      requestId,
      kind,
      originInstanceId,
      targetSurfaceId: text(payload.targetSurfaceId, 'HANDOFF_SURFACE', 64),
      route: routePayload(payload.route),
      card: cardPayload(payload.card),
      requestedAt: context.now,
    }
    : {
      requestId,
      kind,
      originInstanceId,
      carry: text(payload.carry, 'CARRY_SUMMARY', 512),
      card: cardPayload(payload.card),
      requestedAt: context.now,
    };
  const eventPayload: JsonRecord = kind === 'handoff'
    ? {
      requestId,
      originInstanceId,
      targetSurfaceId: request.targetSurfaceId as string,
      route: request.route as JsonRecord,
      card: request.card as JsonRecord,
    }
    : {
      requestId,
      originInstanceId,
      carry: request.carry as string,
      card: request.card as JsonRecord,
    };
  return {
    state: {
      ...current,
      productRequests: {
        sequence,
        log: [...requests.log, request].slice(-MAX_PRODUCT_REQUEST_LOG),
      },
    },
    events: [{
      type: kind === 'handoff' ? 'desktop.handoff.requested' : 'desktop.context-projection.requested',
      payload: eventPayload,
    }],
  };
}

function authToJson(auth: AuthState): JsonRecord {
  return {
    persona: { ...auth.persona },
    initialStatus: auth.initialStatus,
    sessions: Object.fromEntries(
      Object.entries(auth.sessions).map(([instanceId, session]) => [instanceId, { ...session }]),
    ),
    attemptSequence: auth.attemptSequence,
    sessionRevision: auth.sessionRevision,
  };
}

function withSession(
  current: JsonRecord,
  auth: AuthState,
  instanceId: string,
  session: AuthSession,
  sessionRevision: number,
  attemptSequence?: number,
): JsonRecord {
  return {
    ...current,
    auth: authToJson({
      ...auth,
      sessionRevision,
      attemptSequence: attemptSequence ?? auth.attemptSequence,
      sessions: { ...auth.sessions, [instanceId]: session },
    }),
  };
}

function authInstance(payload: JsonRecord, envelope: DesktopSimulatorCommandEnvelope): string {
  const instanceId = text(payload.instanceId, 'AUTH_INSTANCE', 128);
  if (envelope.issuer.kind !== 'instance'
    || envelope.issuer.moduleId !== 'desktop'
    || envelope.issuer.instanceId !== instanceId) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_INSTANCE_REJECTED');
  }
  return instanceId;
}

function oauthCallback(redirectUri: string, callbackOrigin: string): void {
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error('DESKTOP_SIMULATOR_AUTH_REDIRECT_URI_INVALID');
  }
  if (redirect.origin !== callbackOrigin
    || redirect.protocol !== 'http:'
    || (redirect.hostname !== '127.0.0.1' && redirect.hostname !== 'localhost')
    || redirect.username || redirect.password || redirect.hash) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_REDIRECT_URI_INVALID');
  }
}

function reduceAuthBeginLogin(
  current: JsonRecord,
  auth: AuthState,
  payload: JsonRecord,
  envelope: DesktopSimulatorCommandEnvelope,
): Reduction {
  const instanceId = authInstance(payload, envelope);
  const redirectUri = text(payload.redirectUri, 'AUTH_REDIRECT_URI', 512);
  const callbackOrigin = text(payload.callbackOrigin, 'AUTH_CALLBACK_ORIGIN', 256);
  oauthCallback(redirectUri, callbackOrigin);
  const session = sessionFor(auth, instanceId);
  if (session.status !== 'anonymous') {
    throw new Error('DESKTOP_SIMULATOR_AUTH_BEGIN_REJECTED');
  }
  const attemptSequence = auth.attemptSequence + 1;
  const loginAttemptId = `sim-login-attempt-${attemptSequence}`;
  const oauthState = `sim-oauth-state-${attemptSequence}`;
  const oauthNonce = `sim-oauth-nonce-${attemptSequence}`;
  const oauthCode = `sim-oauth-code-${attemptSequence}`;
  const authorizationUrl = `https://simulator.invalid/oauth/authorize?client_id=sim-desktop-shell&redirect_uri=${encodeURIComponent(redirectUri)}&state=${oauthState}&nonce=${oauthNonce}`;
  const sessionRevision = auth.sessionRevision + 1;
  return {
    state: withSession(current, auth, instanceId, {
      status: 'login-pending',
      loginAttemptId,
      oauthState,
      oauthNonce,
      oauthCode,
      redirectUri,
      callbackOrigin,
      authorizationUrl,
      authenticatedAt: null,
    }, sessionRevision, attemptSequence),
    events: [{
      type: 'desktop.auth.login.pending',
      payload: { instanceId, loginAttemptId, authorizationUrl, state: oauthState, nonce: oauthNonce },
    }],
  };
}

function reduceAuthOauthOpen(
  current: JsonRecord,
  auth: AuthState,
  payload: JsonRecord,
  envelope: DesktopSimulatorCommandEnvelope,
): Reduction {
  const instanceId = authInstance(payload, envelope);
  const url = text(payload.url, 'AUTH_OAUTH_URL', 512);
  const oauthState = text(payload.state, 'AUTH_OAUTH_STATE', 128);
  const session = sessionFor(auth, instanceId);
  if (session.status !== 'login-pending'
    || session.oauthState !== oauthState
    || session.authorizationUrl !== url) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_OAUTH_REJECTED');
  }
  return {
    state: current,
    events: [{
      type: 'desktop.auth.oauth.callback',
      payload: {
        instanceId,
        loginAttemptId: session.loginAttemptId,
        code: session.oauthCode,
        state: session.oauthState,
        redirectUri: session.redirectUri,
      },
    }],
  };
}

function reduceAuthCompleteLogin(
  current: JsonRecord,
  auth: AuthState,
  payload: JsonRecord,
  context: DesktopSimulatorBehaviorContext,
  envelope: DesktopSimulatorCommandEnvelope,
): Reduction {
  const instanceId = authInstance(payload, envelope);
  const callbackOrigin = text(payload.callbackOrigin, 'AUTH_CALLBACK_ORIGIN', 256);
  const redirectUri = text(payload.redirectUri, 'AUTH_REDIRECT_URI', 512);
  oauthCallback(redirectUri, callbackOrigin);
  const session = sessionFor(auth, instanceId);
  if (session.status !== 'login-pending'
    || session.loginAttemptId !== payload.loginAttemptId
    || session.oauthCode !== payload.code
    || session.oauthState !== payload.state
    || session.oauthNonce !== payload.nonce
    || session.redirectUri !== redirectUri
    || session.callbackOrigin !== callbackOrigin) {
    throw new Error('DESKTOP_SIMULATOR_AUTH_COMPLETE_REJECTED');
  }
  const sessionRevision = auth.sessionRevision + 1;
  return {
    state: withSession(current, auth, instanceId, {
      ...anonymousSession(),
      status: 'authenticated',
      authenticatedAt: context.now,
    }, sessionRevision),
    events: [{
      type: 'desktop.auth.session.authenticated',
      payload: {
        instanceId,
        sessionRevision,
        persona: { ...auth.persona },
        authenticatedAt: context.now,
      },
    }],
  };
}

function reduceAuthLogout(
  current: JsonRecord,
  auth: AuthState,
  payload: JsonRecord,
  envelope: DesktopSimulatorCommandEnvelope,
): Reduction {
  const instanceId = authInstance(payload, envelope);
  const session = sessionFor(auth, instanceId);
  if (session.status !== 'authenticated') {
    throw new Error('DESKTOP_SIMULATOR_AUTH_LOGOUT_REJECTED');
  }
  const sessionRevision = auth.sessionRevision + 1;
  return {
    state: withSession(current, auth, instanceId, anonymousSession(), sessionRevision),
    events: [{
      type: 'desktop.auth.session.anonymous',
      payload: { instanceId, sessionRevision },
    }],
  };
}

export const desktopSimulatorBehavior = Object.freeze({
  initialState(input: DesktopSimulatorInitialInput): DesktopSimulatorJsonValue {
    const moduleData = record(input.moduleData, 'MODULE_DATA');
    const locale = moduleData.locale;
    if (locale !== 'en' && locale !== 'zh') {
      throw new Error('DESKTOP_SIMULATOR_LOCALE_INVALID');
    }
    const authModuleData = record(moduleData.auth ?? null, 'AUTH_MODULE_DATA');
    const initialStatus = authModuleData.initialStatus;
    if (initialStatus !== 'anonymous' && initialStatus !== 'authenticated') {
      throw new Error('DESKTOP_SIMULATOR_AUTH_INITIAL_STATUS_INVALID');
    }
    const productControl = record(moduleData.productControl ?? null, 'PRODUCT_CONTROL_MODULE_DATA');
    if (productControl.initialStatus !== 'ready_for_use') {
      throw new Error('DESKTOP_SIMULATOR_PRODUCT_CONTROL_INVALID');
    }
    const aiConfig = record(moduleData.aiConfig ?? null, 'AI_CONFIG_MODULE_DATA');
    if (aiConfig.runtimeStatus !== 'unavailable') {
      throw new Error('DESKTOP_SIMULATOR_AI_CONFIG_INVALID');
    }
    return {
      protocolRevision: 1,
      locale,
      appliedAt: null,
      bootstrapReady: true,
      auth: authToJson({
        persona: personaFrom(authModuleData.persona),
        initialStatus,
        sessions: {},
        attemptSequence: 0,
        sessionRevision: 0,
      }),
      productControl: { status: 'ready_for_use' },
      aiConfig: { runtimeStatus: 'unavailable' },
      productRequests: { sequence: 0, log: [] },
    };
  },
  reduce(
    currentValue: DesktopSimulatorJsonValue,
    envelope: DesktopSimulatorCommandEnvelope,
    context: DesktopSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    if (envelope.type === 'desktop.renderer.timer.fire') {
      const payload = record(envelope.payload, 'TIMER_PAYLOAD');
      if (typeof payload.token !== 'string' || payload.token.length === 0 || payload.token.length > 128) {
        throw new Error('DESKTOP_SIMULATOR_TIMER_TOKEN_INVALID');
      }
      return {
        state: current,
        events: [{ type: 'desktop.renderer.timer.fired', payload: { token: payload.token } }],
      };
    }
    if (envelope.type === 'desktop.locale.apply') {
      const payload = record(envelope.payload, 'LOCALE_PAYLOAD');
      if (payload.locale !== 'en' && payload.locale !== 'zh') {
        throw new Error('DESKTOP_SIMULATOR_LOCALE_INVALID');
      }
      return {
        state: { ...current, locale: payload.locale, appliedAt: context.now },
        events: [],
      };
    }
    if (envelope.type.startsWith('desktop.auth.')) {
      const auth = authSlice(current.auth ?? null);
      const payload = record(envelope.payload, 'AUTH_PAYLOAD');
      if (envelope.type === 'desktop.auth.begin-login') {
        return reduceAuthBeginLogin(current, auth, payload, envelope);
      }
      if (envelope.type === 'desktop.auth.oauth.open') {
        return reduceAuthOauthOpen(current, auth, payload, envelope);
      }
      if (envelope.type === 'desktop.auth.complete-login') {
        return reduceAuthCompleteLogin(current, auth, payload, context, envelope);
      }
      if (envelope.type === 'desktop.auth.logout') {
        return reduceAuthLogout(current, auth, payload, envelope);
      }
    }
    if (envelope.type === 'desktop.handoff.request') {
      return reduceProductRequest(current, record(envelope.payload, 'HANDOFF_PAYLOAD'), context, 'handoff');
    }
    if (envelope.type === 'desktop.context-projection.request') {
      return reduceProductRequest(current, record(envelope.payload, 'CARRY_PAYLOAD'), context, 'carry');
    }
    throw new Error(`DESKTOP_SIMULATOR_COMMAND_UNDECLARED:${envelope.type}`);
  },
  project(
    currentValue: DesktopSimulatorJsonValue,
    instance: DesktopSimulatorProjectionInput,
  ): DesktopSimulatorJsonValue {
    const current = state(currentValue);
    const auth = authSlice(current.auth ?? null);
    const session = sessionFor(auth, instance.instanceId);
    const projectedAuth: JsonRecord = {
      status: session.status,
      sessionRevision: auth.sessionRevision,
      persona: session.status === 'authenticated' ? { ...auth.persona } : null,
      authenticatedAt: session.authenticatedAt,
    };
    return {
      ...current,
      auth: projectedAuth,
      surfaceId: instance.surfaceId,
      route: {
        pathname: instance.route.pathname,
        search: instance.route.search.map(({ key, value }) => ({ key, value })),
        fragment: instance.route.fragment,
      },
    };
  },
});
