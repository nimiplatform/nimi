import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDesktopAppOriginProtocol } from '../src-electron/app-origin-protocol.js';

const roots: string[] = [];
test.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'nimi-app-origin-'));
  roots.push(root);
  const desktop = path.join(root, 'desktop');
  const avatar = path.join(root, 'avatar');
  await Promise.all([mkdir(desktop), mkdir(avatar)]);
  await writeFile(path.join(desktop, 'index.html'), '<main>desktop</main>');
  await writeFile(path.join(avatar, 'index.html'), '<main>avatar</main>');
  return { desktop, avatar };
}

function protocolCapture() {
  let handler: ((request: Request) => Promise<Response>) | null = null;
  return {
    protocol: {
      handle: async (_scheme: string, next: (request: Request) => Promise<Response>) => { handler = next; },
    },
    handler: () => {
      if (!handler) throw new Error('protocol handler was not registered');
      return handler;
    },
  };
}

test('packaged Desktop protocol serves only controlled Desktop and Avatar app origins', async () => {
  const roots = await fixture();
  const capture = protocolCapture();
  const origin = createDesktopAppOriginProtocol({ protocol: capture.protocol as never, roots });
  origin.register();
  const handle = capture.handler();
  assert.equal(await (await handle(new Request('nimi-app://desktop/'))).text(), '<main>desktop</main>');
  assert.equal(await (await handle(new Request('nimi-app://avatar/'))).text(), '<main>avatar</main>');
  assert.equal((await handle(new Request('nimi-app://other/'))).status, 404);
  assert.equal((await handle(new Request('nimi-app://desktop/%2e%2e%2fsecret'))).status, 404);
});

test('packaged Desktop protocol publishes captured Avatar pixels at a controlled URL', async () => {
  const roots = await fixture();
  const capture = protocolCapture();
  const origin = createDesktopAppOriginProtocol({ protocol: capture.protocol as never, roots });
  origin.register();
  const pathname = origin.publishAvatarPreview(Uint8Array.from([137, 80, 78, 71]));
  const handle = capture.handler();
  const response = await handle(new Request(`nimi-app://desktop${pathname}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
  origin.clear();
  assert.equal((await handle(new Request(`nimi-app://desktop${pathname}`))).status, 404);
});
