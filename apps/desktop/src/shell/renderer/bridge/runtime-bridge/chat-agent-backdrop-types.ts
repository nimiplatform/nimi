export type DesktopAgentBackdropBindingRecord = {
  agentId: string;
  displayName: string;
  sourceFilename: string;
  storedPath: string;
  fileUrl: string;
  updatedAtMs: number;
};

export type DesktopAgentBackdropImportInput = {
  agentId: string;
  sourcePath: string;
  importedAtMs?: number | null;
};
