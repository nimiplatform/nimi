import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function manualChunks(id: string) {
  const normalized = id.replaceAll('\\', '/');
  const isNimiSdk = normalized.includes('/node_modules/@nimiplatform/sdk/') || normalized.includes('/nimi-realm/nimi/sdks/typescript/');
  const runtimeProtoPath = '/dist/core-generated/runtime-protobuf/runtime/v1/';
  if (normalized.includes('/node_modules/react/') || normalized.includes('/node_modules/react-dom/')) {
    return 'vendor-react';
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
  if (normalized.includes('/node_modules/@nimiplatform/kit/') || normalized.includes('/nimi-realm/nimi/kit/')) {
    return 'vendor-nimi-kit';
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@nimiplatform/kit/ui', replacement: path.join(repoRoot, 'kit/ui/src') },
      { find: '@nimiplatform/kit/core', replacement: path.join(repoRoot, 'kit/core/src') },
      { find: '@nimiplatform/kit/features/chat', replacement: path.join(repoRoot, 'kit/features/chat/src') },
      { find: '@nimiplatform/kit/features/model-picker', replacement: path.join(repoRoot, 'kit/features/model-picker/src') },
      { find: '@nimiplatform/kit/features/model-config', replacement: path.join(repoRoot, 'kit/features/model-config/src') },
    ],
  },
  optimizeDeps: {
    exclude: [
      '@nimiplatform/kit/ui',
      '@nimiplatform/kit/core',
      '@nimiplatform/kit/features/chat',
      '@nimiplatform/kit/features/model-picker',
      '@nimiplatform/kit/features/model-config',
      '@nimiplatform/kit/features/model-config/headless',
    ],
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
