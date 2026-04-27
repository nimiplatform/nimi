import { invoke } from '@tauri-apps/api/core';

export type ModelManifest = {
  runtimeDir: string;
  modelId: string;
  model3JsonPath: string;
  nimiDir: string | null;
  adapterManifestPath?: string | null;
};

type RustModelManifest = {
  runtime_dir: string;
  model_id: string;
  model3_json_path: string;
  nimi_dir: string | null;
  adapter_manifest_path?: string | null;
};

export async function resolveModelManifest(modelPath: string): Promise<ModelManifest> {
  const raw = await invoke<RustModelManifest>('nimi_avatar_resolve_model', { path: modelPath });
  return {
    runtimeDir: raw.runtime_dir,
    modelId: raw.model_id,
    model3JsonPath: raw.model3_json_path,
    nimiDir: raw.nimi_dir,
    adapterManifestPath: raw.adapter_manifest_path ?? null,
  };
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('nimi_avatar_read_text_file', { path });
}

export async function readBinaryFile(path: string): Promise<ArrayBuffer> {
  const bytes = await invoke<number[]>('nimi_avatar_read_binary_file', { path });
  return new Uint8Array(bytes).buffer;
}

export type Model3Settings = {
  Version: number;
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
    Expressions?: Array<{ Name: string; File: string }>;
    Motions?: Record<string, Array<{ File: string; FadeInTime?: number; FadeOutTime?: number }>>;
  };
  HitAreas?: Array<{ Id: string; Name: string }>;
  Groups?: Array<{ Target: string; Name: string; Ids: string[] }>;
};

export async function loadModel3Settings(manifest: ModelManifest): Promise<Model3Settings> {
  const raw = await readTextFile(manifest.model3JsonPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `invalid model3.json (${manifest.model3JsonPath}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`model3.json did not parse to an object: ${manifest.model3JsonPath}`);
  }
  const settings = parsed as Model3Settings;
  if (typeof settings.Version !== 'number') {
    throw new Error(`model3.json missing Version field: ${manifest.model3JsonPath}`);
  }
  return settings;
}
