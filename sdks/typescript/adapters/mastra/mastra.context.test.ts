import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactRefPart } from '@nimiplatform/sdk';

import {
  createNimiMastraContextBridge,
  createNimiMastraModel,
  generateWithNimiMastraContext,
  streamWithNimiMastraContext,
} from './index';
import { createMastraTestAgent, createNimiFixtureModel } from './mastra.fixtures';

test('Nimi Mastra context bridge also applies to Agent.stream', async () => {
  const fixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: 'streamed' },
      { type: 'done', finishReason: 'stop' },
    ],
  });
  const agent = createMastraTestAgent({
    name: 'runtime-context-stream',
    instructions: 'stream with runtime context',
    model: createNimiMastraModel({ model: fixture.model }),
  });
  const bridge = createNimiMastraContextBridge({
    runner: { id: 'nimi-runtime-stream-owner', name: 'Nimi Runtime Stream Owner' },
    model: fixture.model,
    contextProviders: [{
      id: 'runtime-context-provider',
      load: () => [{ type: 'text', text: 'Runtime context is available for streams.' }],
    }],
  });

  const streamed = await streamWithNimiMastraContext(agent, 'Stream with context.', { contextBridge: bridge });
  let text = '';
  for await (const delta of streamed.textStream) {
    text += delta;
  }

  assert.equal(text, 'streamed');
  const promptText = fixture.calls[0]?.messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
  assert.match(promptText ?? '', /Runtime context is available for streams/);
});

test('Nimi Mastra context bridge projects managed artifact references without reading them as data', async () => {
  const fixture = createNimiFixtureModel();
  const bridge = createNimiMastraContextBridge({
    runner: { id: 'nimi-runtime-artifact-owner', name: 'Nimi Runtime Artifact Owner' },
    model: fixture.model,
    contextProviders: [{
      id: 'runtime-artifact-provider',
      load: () => [artifactRefPart({
        artifactId: 'artifact-audio-1',
        mediaType: 'audio/wav',
        displayName: 'voice sample',
      })],
    }],
  });

  const context = await bridge.buildContext();

  assert.equal(context.length, 1);
  assert.match(String(context[0]?.content), /\[artifact audio\/wav voice sample\]/);
  assert.doesNotMatch(String(context[0]?.content), /artifact-audio-1/);
});
