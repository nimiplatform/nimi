import type { StoreActionContext } from './action-context';

export function setAuthState(ctx: StoreActionContext, user: unknown, token: string) {
  ctx.state.auth = { isAuthenticated: true, user, token };
  ctx.emit('authChange', ctx.state.auth);
  ctx.persistState();
}

export function clearAuthState(ctx: StoreActionContext) {
  ctx.state.auth = { isAuthenticated: false, user: null, token: null };
  ctx.emit('authChange', ctx.state.auth);
  ctx.persistState();
}

export function getAuthToken(ctx: StoreActionContext) {
  return ctx.state.auth.token;
}

export function getAuthUser(ctx: StoreActionContext) {
  return ctx.state.auth.user;
}

export function setCurrentSessionState(ctx: StoreActionContext, session: unknown, agent: unknown) {
  ctx.state.session.currentSession = session;
  ctx.state.session.currentAgent = agent;
  ctx.emit('sessionChange', ctx.state.session);
}

export function setRouteState(ctx: StoreActionContext, route: unknown) {
  ctx.state.session.route = route;
  ctx.emit('routeChange', route);
}
