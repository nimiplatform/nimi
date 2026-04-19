import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseMemoryEmbeddingRuntimeBindResult,
  parseMemoryEmbeddingRuntimeCutoverResult,
  parseMemoryEmbeddingRuntimeInspectResult,
  type MemoryEmbeddingRuntimeBindPayload,
  type MemoryEmbeddingRuntimeBindResult,
  type MemoryEmbeddingRuntimeCutoverPayload,
  type MemoryEmbeddingRuntimeCutoverResult,
  type MemoryEmbeddingRuntimeInspectPayload,
  type MemoryEmbeddingRuntimeInspectResult,
} from './types';

export async function inspectMemoryEmbeddingRuntime(
  payload: MemoryEmbeddingRuntimeInspectPayload,
): Promise<MemoryEmbeddingRuntimeInspectResult> {
  if (!hasTauriInvoke()) {
    throw new Error('memory_embedding_runtime_inspect requires Tauri runtime');
  }
  return invokeChecked(
    'memory_embedding_runtime_inspect',
    { payload },
    parseMemoryEmbeddingRuntimeInspectResult,
  );
}

export async function requestMemoryEmbeddingRuntimeBind(
  payload: MemoryEmbeddingRuntimeBindPayload,
): Promise<MemoryEmbeddingRuntimeBindResult> {
  if (!hasTauriInvoke()) {
    throw new Error('memory_embedding_runtime_request_bind requires Tauri runtime');
  }
  return invokeChecked(
    'memory_embedding_runtime_request_bind',
    { payload },
    parseMemoryEmbeddingRuntimeBindResult,
  );
}

export async function requestMemoryEmbeddingRuntimeCutover(
  payload: MemoryEmbeddingRuntimeCutoverPayload,
): Promise<MemoryEmbeddingRuntimeCutoverResult> {
  if (!hasTauriInvoke()) {
    throw new Error('memory_embedding_runtime_request_cutover requires Tauri runtime');
  }
  return invokeChecked(
    'memory_embedding_runtime_request_cutover',
    { payload },
    parseMemoryEmbeddingRuntimeCutoverResult,
  );
}
