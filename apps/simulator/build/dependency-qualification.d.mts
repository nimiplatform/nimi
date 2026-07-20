export interface SelectedDependencyClosureEvidence {
  readonly schema: 'nimi.simulator.selected-dependency-closure/v1';
  readonly packages: readonly Readonly<Record<string, unknown>>[];
  readonly digest: string;
}

export declare function createSelectedDependencyQualifier(options: Readonly<Record<string, unknown>>): {
  readonly isTaintedImporter: (importer?: string | null) => boolean;
  readonly markPackageTarget: (packageName: string, absolutePath: string, importerSelected: boolean) => boolean;
  readonly markResolvedEdge: (importer: string, resolvedId: string) => boolean;
  readonly validateTransform: (code: string, id: string) => boolean;
  readonly finalize: () => SelectedDependencyClosureEvidence;
};
