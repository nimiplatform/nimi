export type VrmAvatarModelManifest = {
  kind: 'vrm';
  modelId: string;
  runtimeDir: string;
  nimiDir: string | null;
  posterPath: string | null;
  vrm: {
    vrmFile: string;
    motionPresetsDir: string | null;
  };
};
