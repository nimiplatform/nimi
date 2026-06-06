import { createNimiClient, textPart } from '@nimiplatform/sdk';

const client = createNimiClient({
  appId: 'example.app-template',
  runtime: {
    transport: {
      type: 'node-grpc',
      endpoint: process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371',
    },
  },
});
const model = client.ai.createRuntimeModel({
  model: { modelId: 'default' },
  routePolicy: 'local',
  subjectUserId: 'local-user',
});

const result = await model.generateText({
  model: model.model,
  messages: [{
    role: 'user',
    content: [textPart('What is Nimi in one sentence?')],
  }],
});

console.log(result.text);
