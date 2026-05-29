export type WorkbenchSectionId =
  | 'app-lab'
  | 'ai-capabilities'
  | 'ui-recipes'
  | 'runs'
  | 'artifacts'
  | 'runtime-trace'
  | 'boundary-checks'
  | 'settings';

export type WorkbenchSection = {
  id: WorkbenchSectionId;
  label: string;
  group: 'workbench' | 'evidence' | 'app';
  description: string;
};

export const workbenchSections: WorkbenchSection[] = [
  {
    id: 'app-lab',
    label: 'App Lab',
    group: 'workbench',
    description: 'Build, run, compose UI, and capture evidence.',
  },
  {
    id: 'ai-capabilities',
    label: 'AI Capabilities',
    group: 'workbench',
    description: 'Runtime-backed capability lanes.',
  },
  {
    id: 'ui-recipes',
    label: 'UI Recipes',
    group: 'workbench',
    description: 'Reviewed Nimi Kit primitives for third-party apps.',
  },
  {
    id: 'runs',
    label: 'Runs',
    group: 'evidence',
    description: 'Persisted capability run history.',
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    group: 'evidence',
    description: 'Image, audio, and world artifacts captured by lanes.',
  },
  {
    id: 'runtime-trace',
    label: 'Runtime Trace',
    group: 'evidence',
    description: 'Runtime projection, trace, and provider catalog.',
  },
  {
    id: 'boundary-checks',
    label: 'Boundary Checks',
    group: 'evidence',
    description: 'App boundary policy and SDK admission checks.',
  },
  {
    id: 'settings',
    label: 'Settings',
    group: 'app',
    description: 'Local drafts, evidence capture, developer toggles.',
  },
];
