import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'example.app-template',
});

const result = await runtime.generate({
  prompt: 'What is Nimi in one sentence?',
});

console.log(result.text);
