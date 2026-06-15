import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
