/**
 * Mod SDK V2 Basics
 *
 * This file shows the current public APIs from @nimiplatform/mod-sdk.
 * A real mod runs inside desktop after host injection (`setModSdkHost`).
 */

import { createAiClient } from '@nimiplatform/mod-sdk/ai';
import { createHookClient } from '@nimiplatform/mod-sdk/hook';

const MOD_ID = 'world.nimi.my-mod';

const hook = createHookClient(MOD_ID);
const ai = createAiClient(MOD_ID);

async function registerHooks() {
  await hook.event.subscribe({
    topic: 'chat.message.created',
    handler: async (payload) => {
      console.log('event payload:', payload);
    },
  });

  await hook.data.register({
    capability: 'data-api.user-math-quiz.sessions.list',
    handler: async (query) => {
      return {
        items: [
          { id: 'session-1', date: '2026-02-24', score: 92 },
          { id: 'session-2', date: '2026-02-23', score: 88 },
        ],
        query,
      };
    },
  });

  const sessions = await hook.data.query({
    capability: 'data-api.user-math-quiz.sessions.list',
    query: { limit: 7 },
  });
  console.log('sessions:', sessions);

  await hook.ui.register({
    slot: 'ui-extension.app.sidebar.mods',
    priority: 10,
    extension: {
      extensionId: 'ui-extension.app.sidebar.mods:world.nimi.my-mod:10',
      strategy: 'append',
      title: 'Math Quiz',
      route: '/mods/math-quiz',
    },
  });

  await hook.turn.register({
    point: 'pre-model',
    priority: 5,
    handler: async (context) => {
      const next = { ...context };
      return next;
    },
  });

  await hook.interMod.registerHandler({
    channel: 'math-quiz.request',
    handler: async (payload) => {
      return { ok: true, received: payload };
    },
  });

  const interModResponse = await hook.interMod.request({
    toModId: 'world.nimi.teacher-assistant',
    channel: 'math-quiz.request',
    payload: { grade: 3, count: 10 },
  });
  console.log('inter-mod response:', interModResponse);
}

async function useAi() {
  const text = await ai.generateText({
    routeHint: 'chat/default',
    prompt: 'Generate 5 grade-3 daily math questions.',
    systemPrompt: 'Return concise JSON.',
    temperature: 0.2,
    maxTokens: 256,
  });
  console.log('ai text:', text.text);

  for await (const event of ai.streamText({
    routeHint: 'chat/default',
    prompt: 'Say hello in one short sentence.',
  })) {
    if (event.type === 'text_delta') {
      process.stdout.write(event.textDelta);
    }
  }
  console.log();
}

async function main() {
  await registerHooks();
  await useAi();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/*
mod.manifest.yaml (current structure)

id: world.nimi.my-mod
name: My Mod
version: 1.0.0
kind: capability-mod
icon: my-mod
entry: ./dist/mods/my-mod/index.js
description: Example mod
capabilities:
  - llm.text.generate
  - llm.text.stream
  - data.register.data-api.user-math-quiz.sessions.list
  - data.query.data-api.user-math-quiz.sessions.list
  - ui.register.ui-extension.app.sidebar.mods
*/
