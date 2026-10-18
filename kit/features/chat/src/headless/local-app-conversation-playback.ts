// Only local playback is coordinated. Runtime voice generation and stored results
// remain independent and are never canceled by choosing another message to hear.
const activePlayers = new Map<string, { owner: symbol; stop: () => void }>();

export function claimConversationPlayback(scope: string, owner: symbol, stop: () => void): () => void {
  const previous = activePlayers.get(scope);
  if (previous && previous.owner !== owner) previous.stop();
  activePlayers.set(scope, { owner, stop });
  return () => {
    if (activePlayers.get(scope)?.owner === owner) activePlayers.delete(scope);
  };
}
