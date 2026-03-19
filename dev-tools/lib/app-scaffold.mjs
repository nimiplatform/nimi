import path from 'node:path';

function buildBasicAppTemplate(versions) {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-nimi-app',
        private: true,
        type: 'module',
        scripts: {
          start: 'tsx index.ts',
        },
        dependencies: {
          '@nimiplatform/sdk': versions.sdkVersion,
        },
        devDependencies: {
          tsx: versions.tsxVersion,
          typescript: versions.typescriptVersion,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'index.ts',
      content: [
        "import { createPlatformClient } from '@nimiplatform/sdk';",
        '',
        'const { runtime } = await createPlatformClient({',
        "  appId: 'my-nimi-app',",
        '});',
        '',
        'const result = await runtime.generate({',
        "  prompt: 'What is Nimi in one sentence?',",
        '});',
        '',
        'console.log(result.text);',
        '',
      ].join('\n'),
    },
    {
      path: '.env.example',
      content: [
        'NIMI_RUNTIME_ENDPOINT=127.0.0.1:46371',
        'NIMI_RUNTIME_CLOUD_OPENAI_API_KEY=',
        'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=',
        '',
      ].join('\n'),
    },
  ];
}

function buildVercelAIAppTemplate(versions) {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'my-nimi-app',
        private: true,
        type: 'module',
        scripts: {
          start: 'tsx index.ts',
        },
        dependencies: {
          '@nimiplatform/sdk': versions.sdkVersion,
          ai: versions.aiSdkVersion,
        },
        devDependencies: {
          tsx: versions.tsxVersion,
          typescript: versions.typescriptVersion,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
      }, null, 2) + '\n',
    },
    {
      path: 'index.ts',
      content: [
        "import { createPlatformClient } from '@nimiplatform/sdk';",
        "import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';",
        "import { generateText } from 'ai';",
        '',
        'const { runtime } = await createPlatformClient({',
        "  appId: 'my-nimi-app',",
        '});',
        'const nimi = createNimiAiProvider({ runtime });',
        '',
        'const { text } = await generateText({',
        "  model: nimi.text('gemini/default'),",
        "  prompt: 'Hello from Vercel AI SDK + Nimi',",
        '});',
        '',
        'console.log(text);',
        '',
      ].join('\n'),
    },
    {
      path: '.env.example',
      content: [
        'NIMI_RUNTIME_ENDPOINT=127.0.0.1:46371',
        'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=',
        '',
      ].join('\n'),
    },
  ];
}

export function createAppScaffold(input) {
  const { cwd, options, versions, createFileTree, ensureDirEmptyOrMissing } = input;
  const template = String(options.template || '').trim() || 'basic';
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || 'my-nimi-app');
  ensureDirEmptyOrMissing(targetDir);
  input.mkdirSync(targetDir, { recursive: true });
  switch (template) {
    case 'basic':
      createFileTree(targetDir, buildBasicAppTemplate(versions));
      break;
    case 'vercel-ai':
      createFileTree(targetDir, buildVercelAIAppTemplate(versions));
      break;
    default:
      throw new Error(`Unsupported app template: ${template}`);
  }
  process.stdout.write(`[nimi-app] created ${template} app scaffold at ${targetDir}\n`);
}
