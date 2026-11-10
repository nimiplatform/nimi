import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { prepareRuntimeClientLogin, completeRuntimeClientLogin, matchesRuntimeClientCallback,
  type RuntimeClientLoginOptions, type RuntimeClientLoginTransaction, type RuntimeClientSession } from '@nimiplatform/sdk/realm/runtime-client';
import { Accounts } from './accounts.ts';
import { resolveReferenceNetwork } from './server-network.ts';

// This is a development reference website, not an official Nimi account or management server.
const { origin, bindHost, officialWebBaseUrl } = resolveReferenceNetwork({
  websiteOrigin: process.env.REFERENCE_ORIGIN,
  bindHost: process.env.REFERENCE_BIND_HOST,
  officialWebOrigin: required('REFERENCE_NIMI_WEB_URL'),
});
const appId = required('REFERENCE_APP_ID');
const clientId = required('REFERENCE_CLIENT_ID');
const realmEnvironmentId = required('REFERENCE_REALM_ENVIRONMENT');
const realmBaseUrl = required('REFERENCE_REALM_URL');
const data = resolve(process.env.REFERENCE_DATA_DIR ?? '.data');
await mkdir(data, { recursive: true });
const accounts = new Accounts(resolve(data, 'website.sqlite'));
type Session = { userId: string; context: string; expiresAt: number; transaction?: RuntimeClientLoginTransaction;
  nimi?: RuntimeClientSession; ending: RuntimeClientSession[]; busy?: boolean };
const sessions = new Map<string, Session>();
const attempts = new Map<string, { count: number; until: number }>();
const cookieName = '__Host-nimi-reference';
const nonce = () => randomBytes(32).toString('base64url');

function sessionFor(req: IncomingMessage): Session | undefined {
  const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const found = cookie ? sessions.get(cookie) : undefined;
  if (found && found.expiresAt > Date.now()) return found;
  if (found) { sessions.delete(cookie!); invalidate(found); void endContexts(found).catch(() => undefined); }
  return undefined;
}
function loginOptions(session: Session): RuntimeClientLoginOptions {
  return { appId, clientId, realmEnvironmentId, realmBaseUrl, officialWebBaseUrl, redirectUri: new URL('/nimi/callback', origin).href,
    currentUserContext: () => session.expiresAt > Date.now() ? session.context : null };
}
function invalidate(session: Session): void {
  session.context = nonce(); session.transaction = undefined;
  if (session.nimi) { session.ending.push(session.nimi); session.nimi = undefined; }
  // end() fences local use synchronously, before its network request.
  for (const context of session.ending) void context.end().catch(() => undefined);
}
async function endContexts(session: Session): Promise<void> {
  const pending = [...session.ending];
  const results = await Promise.allSettled(pending.map(item => item.end()));
  results.forEach((result, index) => { if (result.status === 'fulfilled') session.ending = session.ending.filter(item => item !== pending[index]); });
  if (session.ending.length) throw new Error('本地连接已关闭，但 Realm 撤销尚未确认。请稍后重试。');
}
function currentSession(req: IncomingMessage): Session {
  const session = sessionFor(req);
  if (!session) throw new HttpError(401, '请先登录此网站。');
  if (req.headers['x-site-context'] !== session.context) throw new HttpError(409, '网站账号上下文已改变，请刷新页面。');
  return session;
}
function currentNimi(session: Session): RuntimeClientSession {
  if (!session.nimi?.active) throw new HttpError(409, '请重新通过 Nimi 登录以连接主 Runtime。');
  return session.nimi;
}
function assertUnchanged(session: Session, context: string): void {
  if (session.context !== context || session.expiresAt <= Date.now()) throw new HttpError(409, '网站账号上下文已改变。');
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage, fields: readonly string[]): Promise<Record<string, string>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, '需要 JSON 请求。');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 36 * 1024) throw new HttpError(413, '请求过大。'); chunks.push(chunk); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON 请求无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
    || fields.some(field => typeof (value as Record<string, unknown>)[field] !== 'string')) throw new HttpError(400, '请求字段无效。');
  return value as Record<string, string>;
}
async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.headers.host !== origin.host) throw new HttpError(400, '来源主机不匹配。');
  const url = new URL(req.url ?? '/', origin);
  if (req.method === 'POST' && req.headers.origin !== origin.origin) throw new HttpError(403, '请求来源不匹配。');
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const session = sessionFor(req);
    json(res, 200, session ? { user: accounts.get(session.userId), context: session.context,
      nimi: session.nimi?.active ? session.nimi.identity : null } : { user: null, context: null, nimi: null }); return;
  }
  if (req.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
    if (sessionFor(req)) throw new HttpError(409, '请先退出当前网站账号。');
    const key = req.socket.remoteAddress ?? 'loopback';
    let budget = attempts.get(key);
    if (!budget || budget.until < Date.now()) { budget = { count: 0, until: Date.now() + 300_000 }; attempts.set(key, budget); }
    if (++budget.count > 20) throw new HttpError(429, '登录尝试过多，请五分钟后重试。');
    const input = await body(req, ['username', 'password']);
    const user = url.pathname.endsWith('register') ? await accounts.register(input.username, input.password) : await accounts.login(input.username, input.password);
    const id = nonce(); sessions.set(id, { userId: user.id, context: nonce(), expiresAt: Date.now() + 8 * 3600_000, ending: [] });
    res.setHeader('set-cookie', `${cookieName}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
    json(res, 200, { ok: true }); return;
  }
  if (req.method === 'GET' && url.pathname === '/nimi/callback') {
    const session = sessionFor(req), transaction = session?.transaction;
    if (!session || !transaction || session.busy) throw new HttpError(409, '登录请求已失效，请从网站重新发起。');
    const code = url.searchParams.get('code') ?? '';
    const cancelled = url.searchParams.get('error') === 'access_denied';
    if (!matchesRuntimeClientCallback(url.href, transaction.redirectUri) || url.searchParams.get('state') !== transaction.state
      || url.searchParams.size !== 2 || (!cancelled && !/^[A-Za-z0-9_-]{43}$/.test(code))) {
      throw new HttpError(400, '登录回调与当前请求不匹配。');
    }
    const context = session.context; session.transaction = undefined; session.busy = true;
    try {
      const nimi = await completeRuntimeClientLogin(loginOptions(session), transaction, url.href);
      try { assertUnchanged(session, context); accounts.associate(session.userId, nimi.identity.accountId); }
      catch (error) { await nimi.end().catch(() => undefined); throw error; }
      session.nimi = nimi;
      res.writeHead(303, { location: '/' }); res.end();
    } finally { session.busy = false; }
    return;
  }
  if (req.method === 'POST' && ['/api/logout', '/api/unlink', '/api/connect', '/api/runtime/end', '/api/runtime/context', '/api/runtime/offer', '/api/runtime/answer'].includes(url.pathname)) {
    const session = currentSession(req);
    if (url.pathname === '/api/runtime/end') {
      await body(req, []); invalidate(session); await endContexts(session); json(res, 200, { ok: true }); return;
    }
    if (url.pathname === '/api/logout' || url.pathname === '/api/unlink') {
      await body(req, []);
      const affected = url.pathname === '/api/unlink' ? [...sessions.values()].filter(item => item.userId === session.userId) : [session];
      for (const item of affected) invalidate(item);
      // A failed revocation leaves a locally closed session available only for an explicit retry.
      await Promise.all(affected.map(endContexts));
      if (url.pathname === '/api/unlink') accounts.unlink(session.userId);
      else {
        session.expiresAt = 0;
        for (const [id, item] of sessions) if (item === session) sessions.delete(id);
        res.setHeader('set-cookie', `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      }
      json(res, 200, { ok: true }); return;
    }
    if (url.pathname === '/api/connect') {
      await body(req, []);
      if (session.busy) throw new HttpError(409, '正在完成 Nimi 登录，请稍候。');
      session.busy = true;
      try {
        invalidate(session); await endContexts(session);
        const context = session.context;
        const prepared = await prepareRuntimeClientLogin(loginOptions(session), accounts.get(session.userId)?.nimiAccountId ?? undefined);
        assertUnchanged(session, context); session.transaction = prepared.transaction;
        json(res, 200, { authorizationUrl: prepared.authorizationUrl });
      } finally { session.busy = false; }
      return;
    }
    const nimi = currentNimi(session), context = session.context;
    let result: unknown;
    if (url.pathname === '/api/runtime/context') { await body(req, []); result = await nimi.read(); }
    else if (url.pathname === '/api/runtime/offer') {
      const input = await body(req, ['offerSdp', 'bindingId']); result = await nimi.createConnection(input.offerSdp, input.bindingId);
    } else {
      const input = await body(req, ['connectionId', 'bindingId']); result = await nimi.readConnection(input.connectionId, input.bindingId);
    }
    assertUnchanged(session, context); json(res, 200, result); return;
  }
  const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/client.js': ['client.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
  const file = files[url.pathname];
  if (req.method === 'GET' && file) { const content = await readFile(new URL('../dist/' + file[0], import.meta.url)); res.writeHead(200, { 'content-type': file[1] + '; charset=utf-8' }); res.end(content); return; }
  throw new HttpError(404, '此路径不可用。');
}
class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
function required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
const server = createServer({ key: await readFile(required('REFERENCE_TLS_KEY')), cert: await readFile(required('REFERENCE_TLS_CERT')) },
  (req, res) => { void route(req, res).catch(error => {
    if (!res.headersSent) json(res, error instanceof HttpError ? error.status : 400, { error: error instanceof Error ? error.message : '请求失败。' }); else res.destroy();
  }); });
server.listen(Number(origin.port || 443), bindHost, () => process.stdout.write(`Reference website listening at ${origin.origin}\n`));
// No AI proxy route exists. Only typed identity and signaling cross this server.
