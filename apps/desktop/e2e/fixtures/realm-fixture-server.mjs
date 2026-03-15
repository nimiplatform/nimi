import fs from 'node:fs';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(payload)}\n`);
}

function notFound(response, pathname) {
  json(response, 404, {
    error: 'fixture_not_found',
    pathname,
  });
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

function lookupUser(manifest, idOrHandle, mode) {
  const fixture = manifest.realmFixture || {};
  const users = [];
  if (fixture.currentUser) {
    users.push(fixture.currentUser);
  }
  const friendItems = Array.isArray(fixture.friends?.items) ? fixture.friends.items : [];
  const blockedItems = Array.isArray(fixture.blocked?.items) ? fixture.blocked.items : [];
  const creatorAgents = Array.isArray(fixture.creatorAgents) ? fixture.creatorAgents : [];
  const searchUsers = Array.isArray(fixture.searchUsers?.items) ? fixture.searchUsers.items : [];
  users.push(...friendItems, ...blockedItems, ...creatorAgents, ...searchUsers);
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
  if (pathname === '/__fixture/control/manifest') {
    json(response, 200, manifest);
    return;
  }
  notFound(response, pathname);
}

function handleApi(request, response, manifestPath) {
  const manifest = readJsonFile(manifestPath);
  const fixture = manifest.realmFixture || {};
  const requestUrl = new URL(request.url, 'http://127.0.0.1');
  const pathname = requestUrl.pathname;

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

  if (fixture.restOnline === false) {
    json(response, 503, {
      message: 'fixture rest offline',
      scenarioId: manifest.scenarioId,
    });
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

  if (request.method === 'GET' && pathname === '/api/human/me/friends/pending') {
    json(response, 200, fixture.pendingFriends || { received: [], sent: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/human/me/blocks') {
    json(response, 200, fixture.blocked || { items: [] });
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/creator/agents') {
    json(response, 200, Array.isArray(fixture.creatorAgents) ? fixture.creatorAgents : []);
    return undefined;
  }

  if (request.method === 'GET' && pathname === '/api/world') {
    json(response, 200, Array.isArray(fixture.worlds) ? fixture.worlds : []);
    return undefined;
  }

  const worldDetailMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)$/u);
  if (request.method === 'GET' && worldDetailMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldDetailMatch[1]));
    if (!world) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, world);
    return undefined;
  }

  const worldAgentsMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/agents$/u);
  if (request.method === 'GET' && worldAgentsMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldAgentsMatch[1]));
    json(response, 200, Array.isArray(world?.agents) ? world.agents : []);
    return undefined;
  }

  const worldDetailWithAgentsMatch = pathname.match(/^\/api\/world\/by-id\/([^/]+)\/detail-with-agents$/u);
  if (request.method === 'GET' && worldDetailWithAgentsMatch) {
    const world = lookupWorld(manifest, decodeURIComponent(worldDetailWithAgentsMatch[1]));
    if (!world) {
      notFound(response, pathname);
      return undefined;
    }
    json(response, 200, {
      ...world,
      agents: Array.isArray(world.agents) ? world.agents : [],
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
