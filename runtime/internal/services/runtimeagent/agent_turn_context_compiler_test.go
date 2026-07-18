package runtimeagent

import (
	"bytes"
	"strings"
	"testing"
)

func agentTurnContextTestSnapshot(t *testing.T, kind string) localAgentSourceSnapshotV2 {
	t.Helper()
	vectorName := "world-character"
	if kind == "realmPersona" || kind == "personaCharacter" {
		vectorName = "persona-character"
	}
	vector := loadSourceMaterializationReferenceVectorV3(t, vectorName)
	verified, err := verifySourceMaterializationPacketV3(
		bytes.NewReader(vector.Packet),
		bytes.NewReader(vector.CurrentJWKS),
		sourceMaterializationExpectationFromVectorV3(t, vector),
	)
	if err != nil {
		t.Fatalf("verify context test Packet v3: %v", err)
	}
	localAgentRef := runtimeGeneratedLocalAgentRefPrefix + "context-" + vectorName
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, localAgentRef)
	if err != nil {
		t.Fatalf("finalize context test SnapshotV2: %v", err)
	}
	return snapshot
}

func agentTurnContextTestInput(t *testing.T, kind string) agentTurnContextCompileInput {
	t.Helper()
	snapshot := agentTurnContextTestSnapshot(t, kind)
	return agentTurnContextCompileInput{
		Snapshot:             snapshot,
		LocalAgentRef:        snapshot.LocalAgentRef,
		ConversationAnchorID: "anchor-context-1",
		TurnID:               "turn-context-3",
		RequestID:            "request-context-3",
		RuntimePolicy: []agentTurnRuntimePolicyInput{{
			PolicyID: "local-agent-safety",
			Version:  "v1",
			Text:     "Protect private context and obey only Runtime-granted capabilities.",
		}},
		OutputContract: agentTurnOutputContractInput{
			ContractID: "apml-message",
			Version:    "v1",
			APML:       "Return one strict <message id=\"message-0\"> APML root and no repair fallback.",
		},
		Relationships: []agentTurnRelationshipInput{{
			RelationshipID: "dyad-user-1",
			Scope:          "dyadic",
			ProvenanceRef:  "relationship-projection-7",
			Summary:        "The user and agent are building mutual trust.",
			Rank:           90,
		}},
		Memory: []agentTurnMemoryInput{
			{MemoryID: "memory-high", Scope: "agent_core", ProvenanceRef: "memory-record-high", Text: "Prefer precise explanations.", RelevanceRank: 90},
			{MemoryID: "memory-low", Scope: "dyadic", ProvenanceRef: "memory-record-low", Text: "The user likes concise examples.", RelevanceRank: 10},
		},
		Transcript: []agentTurnTranscriptPairInput{
			{TurnID: "turn-1", Sequence: 1, UserText: "Who are you?", AssistantText: "I am the materialized LocalAgent."},
			{TurnID: "turn-2", Sequence: 2, UserText: "What world is this?", AssistantText: "This is the canonical fixture world."},
		},
		Capabilities: []agentTurnCapabilityInput{{
			CapabilityID: "image.generate",
			Kind:         "tool",
			Version:      "v1",
			Description:  "Generate an image through the admitted Runtime route.",
			Authorized:   true,
			Ready:        true,
		}},
		CurrentUserTurn: agentTurnCurrentUserInput{Text: "Continue from our prior conversation."},
		Budget: agentTurnContextBudgetInput{
			ContextWindowTokens:   32768,
			ReservedOutputTokens:  2048,
			ReservedSafetyTokens:  512,
			ReservedAdapterTokens: 128,
		},
		Route: agentTurnContextRouteInput{
			RouteDigest:           strings.Repeat("1", 64),
			CatalogRevisionDigest: strings.Repeat("2", 64),
		},
	}
}

func TestAgentTurnContextHashesAreStableAcyclicAndInstanceBound(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	first, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Manifest.ContextContentHash != second.Manifest.ContextContentHash || first.Manifest.PromptHash != second.Manifest.PromptHash || first.Manifest.ManifestInstanceHash != second.Manifest.ManifestInstanceHash {
		t.Fatalf("same input hash drift: first=%+v second=%+v", first.Manifest, second.Manifest)
	}
	input.RequestID = "request-context-retry"
	input.TurnID = "turn-context-retry"
	input.Transcript[0].TurnID = "turn-1-replayed"
	input.Transcript[1].TurnID = "turn-2-replayed"
	retry, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Manifest.ContextContentHash != first.Manifest.ContextContentHash || retry.Manifest.PromptHash != first.Manifest.PromptHash {
		t.Fatalf("request/current/history turn ids changed semantic hashes: first=%+v retry=%+v", first.Manifest, retry.Manifest)
	}
	if retry.Manifest.ManifestInstanceHash == first.Manifest.ManifestInstanceHash {
		t.Fatal("new request/turn instance did not change manifestInstanceHash")
	}
	withoutSelf := retry.Manifest
	withoutSelf.ManifestInstanceHash = ""
	recomputed, err := hashAgentTurnContextManifest(withoutSelf)
	if err != nil || recomputed != retry.Manifest.ManifestInstanceHash {
		t.Fatalf("acyclic manifest hash recompute=%q want=%q err=%v", recomputed, retry.Manifest.ManifestInstanceHash, err)
	}
	if _, err := hashAgentTurnContextManifest(retry.Manifest); err == nil {
		t.Fatal("manifest hashing accepted a self-referential instance hash")
	}
}

func TestAgentTurnRuntimeRelationshipBindsProvenanceWithoutSendingItToProvider(t *testing.T) {
	t.Parallel()
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Relationships[0].ProvenanceRef = "runtime.agent.internal.chat_sidecar:agent_turn_01KXARP17MEG56VQDERM63SEZ0:01KXARQ7AQQB3K6YNYKWSTNSS2"
	input.Relationships[0].Summary = "user-e2e-786db1f023c7028d preferred_name 墨契"
	first, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	providerText := agentTurnContextTestProviderText(first.ProviderPrompt)
	if strings.Contains(providerText, input.Relationships[0].ProvenanceRef) {
		t.Fatal("provider-visible relationship content must not carry provenance transport metadata")
	}
	firstLane := agentTurnContextTestLane(t, first.PrivateLanes, agentTurnContextLaneRelationshipContext)
	var firstRuntimeRelationship *agentTurnContextItem
	for index := range firstLane.Items {
		if firstLane.Items[index].StableID == "runtime.relationship.dyad-user-1" {
			firstRuntimeRelationship = &firstLane.Items[index]
			break
		}
	}
	if firstRuntimeRelationship == nil {
		t.Fatal("runtime relationship item is missing")
	}
	if firstRuntimeRelationship.TokenEstimate > 340 {
		t.Fatalf("runtime relationship provider projection exceeds compact mandatory-lane budget: %d", firstRuntimeRelationship.TokenEstimate)
	}

	input.Relationships[0].ProvenanceRef += ":revision-2"
	second, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	secondLane := agentTurnContextTestLane(t, second.PrivateLanes, agentTurnContextLaneRelationshipContext)
	var secondRuntimeRelationship *agentTurnContextItem
	for index := range secondLane.Items {
		if secondLane.Items[index].StableID == "runtime.relationship.dyad-user-1" {
			secondRuntimeRelationship = &secondLane.Items[index]
			break
		}
	}
	if secondRuntimeRelationship == nil {
		t.Fatal("runtime relationship item is missing after provenance revision")
	}
	if firstRuntimeRelationship.SourceRef.ContentHash == secondRuntimeRelationship.SourceRef.ContentHash {
		t.Fatal("relationship provenance must remain bound into the private source reference hash")
	}
	if first.Manifest.PromptHash != second.Manifest.PromptHash {
		t.Fatal("provenance-only relationship revision must not alter provider-visible prompt truth")
	}
}

func agentTurnContextTestLane(t *testing.T, lanes []agentTurnContextLane, laneID agentTurnContextLaneID) agentTurnContextLane {
	t.Helper()
	for _, lane := range lanes {
		if lane.LaneID == laneID {
			return lane
		}
	}
	t.Fatalf("lane %s not found", laneID)
	return agentTurnContextLane{}
}
