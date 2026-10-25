type DownloadPhase = { readonly id: string; readonly state: string };

export type DownloadPhaseSnapshot = {
  readonly activation: string;
  readonly transfers: string | undefined;
  readonly environments: string | undefined;
};

type DownloadPhaseObservation = {
  readonly activation: string;
  // Undefined is a failed observation, while [] confirms an empty source.
  readonly transfers: readonly DownloadPhase[] | undefined;
  readonly environments: readonly DownloadPhase[] | undefined;
};

function phaseSignature(items: readonly DownloadPhase[]): string {
  const compare = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
  return JSON.stringify(items.map(item => [item.id, item.state] as const).sort(
    ([leftId, leftState], [rightId, rightState]) => compare(leftId, rightId) || compare(leftState, rightState),
  ));
}

// Called only after the same activation was observed before and after both
// reads. Each source retains its own last confirmed phase facts.
// @nimi-authority: rule.nimi.desktop.product-surfaces.global-downloads
export function reconcileDownloadPhases(previous: DownloadPhaseSnapshot | undefined, current: DownloadPhaseObservation) {
  const baseline = previous?.activation === current.activation ? previous : undefined;
  const activationChanged = previous !== undefined && previous.activation !== current.activation;
  const transfers = current.transfers === undefined ? baseline?.transfers : phaseSignature(current.transfers);
  const environments = current.environments === undefined ? baseline?.environments : phaseSignature(current.environments);
  const transfersChanged = current.transfers !== undefined && baseline?.transfers !== undefined && baseline.transfers !== transfers;
  const environmentsChanged = current.environments !== undefined && baseline?.environments !== undefined && baseline.environments !== environments;
  // A source that has never succeeded may have completed work during the
  // observation gap. Its first success refreshes inventory once, unlike the
  // normal first successful mount or recovery to already confirmed facts.
  const recoveredUnknown = baseline !== undefined && (
    current.transfers !== undefined && baseline.transfers === undefined
    || current.environments !== undefined && baseline.environments === undefined
  );
  return {
    snapshot: { activation: current.activation, transfers, environments } satisfies DownloadPhaseSnapshot,
    invalidate: activationChanged || transfersChanged || environmentsChanged || recoveredUnknown,
    activationChanged,
    transfersChanged,
    environmentsChanged,
    recoveredUnknown,
  };
}
