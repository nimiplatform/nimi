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
const textGeneration = client.ai.createRuntimeModel({
  subjectUserId: 'local-user',
});

const result = await textGeneration.generateText({
  messages: [{
    role: 'user',
    content: [textPart('What is Nimi in one sentence?')],
  }],
});

process.stdout.write(`${result.text}\n`);
