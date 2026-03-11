import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'What is Nimi in one sentence?',
});

console.log(result.text);
