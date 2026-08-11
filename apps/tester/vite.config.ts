import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { validateSimulatorAppSource } from '@nimiplatform/app-tools/simulator-conformance';
import { createSimulatorCssProfileVitePlugin } from '@nimiplatform/app-tools/simulator-css-profile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const testerSource = validateSimulatorAppSource(__dirname);

function manualChunks(id: string) {
  const normalized = id.replaceAll('\\', '/');
  const repoRootNormalized = repoRoot.replaceAll('\\', '/');
  const isNimiSdk =
    normalized.includes('/node_modules/@nimiplatform/sdk/') || normalized.startsWith(`${repoRootNormalized}/sdks/typescript/`);
  const runtimeProtoPath = '/dist/core-generated/runtime-protobuf/runtime/v1/';
  if (normalized.includes('/node_modules/react/') || normalized.includes('/node_modules/react-dom/')) {
    return 'vendor-react';
  }
  if (normalized.includes('/node_modules/i18next/') || normalized.includes('/node_modules/react-i18next/')) {
    return 'vendor-i18n';
  }
  if (normalized.includes('/node_modules/lucide-react/')) {
    return 'vendor-icons';
  }
  if (normalized.includes('/node_modules/@tauri-apps/')) {
    return 'vendor-tauri';
  }
  if (normalized.includes('/node_modules/three/')) {
    return 'vendor-three';
  }
  if (normalized.includes('/node_modules/@protobuf-ts/runtime/')) {
    return 'vendor-protobuf-ts';
  }
  if (isNimiSdk && normalized.includes('/dist/core-generated/runtime-protobuf/google/')) {
    return 'vendor-nimi-sdk-protobuf-google';
  }
  if (isNimiSdk && normalized.includes(runtimeProtoPath)) {
    const protoFile = normalized.slice(normalized.indexOf(runtimeProtoPath) + runtimeProtoPath.length);
    if (protoFile.startsWith('ai') || protoFile === 'artifact_service.js' || protoFile === 'model.js' || protoFile === 'voice.js') {
      return 'vendor-nimi-sdk-protobuf-runtime';
    }
    if (protoFile.startsWith('local_runtime')) {
      return 'vendor-nimi-sdk-protobuf-runtime';
    }
    if (protoFile.startsWith('agent_') || protoFile === 'external_agent.js' || protoFile === 'delegated_control.js') {
      return 'vendor-nimi-sdk-protobuf-agent';
    }
    if (protoFile === 'memory.js' || protoFile === 'knowledge.js') {
      return 'vendor-nimi-sdk-protobuf-memory';
    }
    return 'vendor-nimi-sdk-protobuf-runtime';
  }
  if (isNimiSdk) {
    return 'vendor-nimi-sdk';
  }
  if (normalized.includes('/node_modules/@nimiplatform/kit/') || normalized.startsWith(`${repoRootNormalized}/kit/`)) {
    return 'vendor-nimi-kit';
  }
  if (normalized.includes('/apps/tester/src/shell/i18n/')) {
    return 'tester-i18n';
  }
  if (normalized.includes('/apps/tester/src/tester/workbench/')) {
    return 'tester-workbench';
  }
  if (normalized.includes('/apps/tester/src/tester/app-access/')) {
    return 'tester-app-access';
  }
  return undefined;
}

export default defineConfig({
  base: './',
  plugins: [
    createSimulatorCssProfileVitePlugin({
      compilerRoot: __dirname,
      foundationEntry: path.join(__dirname, 'src/styles.css'),
      apps: [{ rootDir: __dirname, style: testerSource.style }],
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
