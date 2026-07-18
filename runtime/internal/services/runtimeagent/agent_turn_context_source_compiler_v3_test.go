package runtimeagent

import (
	"strings"
	"testing"
)

func TestCompileAgentTurnSourceSnapshotV3OfficialVectorsProduceDeterministicFiveLanes(t *testing.T) {
	for _, vectorName := range []string{"world-character", "persona-character"} {
		vectorName := vectorName
		t.Run(vectorName, func(t *testing.T) {
			verified := verifiedRealmSourceMaterializationVectorV3(t, vectorName)
			snapshot, err := finalizeLocalAgentSourceSnapshotV2(
				verified,
				realmSourceMaterializationProductTestLocalAgentRef("compiler-v3-"+vectorName),
			)
			if err != nil {
				t.Fatalf("finalize SnapshotV2: %v", err)
			}

			first, err := compileAgentTurnSourceSnapshotV3(snapshot)
			if err != nil {
				t.Fatalf("compile SnapshotV2: %v", err)
			}
			encoded, err := encodeLocalAgentSourceSnapshotV2(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			reloaded, err := decodeLocalAgentSourceSnapshotV2(encoded)
			if err != nil {
				t.Fatalf("strict SnapshotV2 reload: %v", err)
			}
			second, err := compileAgentTurnSourceSnapshotV3(reloaded)
			if err != nil {
				t.Fatalf("compile reloaded SnapshotV2: %v", err)
			}

			firstLanes, err := makeAgentTurnContextLanes(first)
			if err != nil {
				t.Fatal(err)
			}
			secondLanes, err := makeAgentTurnContextLanes(second)
			if err != nil {
				t.Fatal(err)
			}
			firstHash, err := hashAgentTurnContextContent(firstLanes)
			if err != nil {
				t.Fatal(err)
			}
			secondHash, err := hashAgentTurnContextContent(secondLanes)
			if err != nil {
				t.Fatal(err)
			}
			if firstHash != secondHash || !isLowerSHA256V3(firstHash) {
				t.Fatalf("SnapshotV2 compiler restart parity hash = %q / %q", firstHash, secondHash)
			}

			assertRealmSourceCompilerFiveLanesV3(t, first)
			assertRealmSourceCompilerTypedItemsV3(t, snapshot, first)
			assertRealmSourceCompilerExemplarV3(t, first)
			assertRealmSourceCompilerNarrativeDualProjectionV3(t, first)
			assertRealmSourceCompilerNoOpenPayloadV3(t, first)
		})
	}
}

func assertRealmSourceCompilerFiveLanesV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem) {
	t.Helper()
	want := map[agentTurnContextLaneID]struct{}{
		agentTurnContextLaneSourceIdentity:      {},
		agentTurnContextLaneSourceBehavior:      {},
		agentTurnContextLaneWorldContext:        {},
		agentTurnContextLaneRelationshipContext: {},
		agentTurnContextLaneSourceKnowledge:     {},
	}
	if len(items) != len(want) {
		t.Fatalf("source compiler lane count = %d, want %d", len(items), len(want))
	}
	for laneID := range want {
		if len(items[laneID]) == 0 {
			t.Fatalf("source compiler lane %q is empty", laneID)
		}
	}
	if len(items[agentTurnContextLaneCapabilityContext]) != 0 {
		t.Fatal("descriptive Realm source capabilities became Runtime capability/tool authority")
	}
}

func assertRealmSourceCompilerTypedItemsV3(t *testing.T, snapshot localAgentSourceSnapshotV2, items map[agentTurnContextLaneID][]agentTurnContextItem) {
	t.Helper()
	seen := make(map[string]struct{})
	for laneID, laneItems := range items {
		for _, item := range laneItems {
			if item.LaneID != laneID || strings.TrimSpace(item.StableID) == "" || strings.TrimSpace(item.SourcePath) == "" ||
				strings.TrimSpace(item.SourceRef.Kind) == "" || strings.TrimSpace(item.SourceRef.RefID) == "" ||
				strings.TrimSpace(item.SourceRef.SchemaVersion) == "" || !isLowerSHA256V3(item.SourceRef.ContentHash) ||
				!isLowerSHA256V3(item.ContentHash) || item.Priority == 0 || item.TokenEstimate == 0 ||
				item.AuthorityOwner != agentTurnContextAuthorityRealmSnapshot || item.TrustClass != agentTurnContextTrustValidatedSource {
				t.Fatalf("invalid typed Realm source item: %+v", item)
			}
			identity := string(laneID) + "\x00" + item.StableID
			if _, duplicate := seen[identity]; duplicate {
				t.Fatalf("duplicate stable Realm source item %q", identity)
			}
			seen[identity] = struct{}{}
			if strings.HasPrefix(item.StableID, "source.identity.") || strings.HasPrefix(item.StableID, "source.behavior.") || strings.HasPrefix(item.StableID, "source.knowledge.") || strings.HasPrefix(item.StableID, "source.relationship.profile.") {
				if item.SourceRef.Kind != snapshot.Semantic.SourceRef.Kind || item.SourceRef.RefID != snapshot.Semantic.SourceRef.ID {
					t.Fatalf("profile item lost CharacterSourceRefV3 binding: %+v", item.SourceRef)
				}
			}
		}
	}
}

func assertRealmSourceCompilerExemplarV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem) {
	t.Helper()
	for _, item := range items[agentTurnContextLaneSourceBehavior] {
		if item.StableID != "source.behavior.dialogue-exemplar.exemplar-source-boundary" {
			continue
		}
		if item.SourcePath != "source.profile.interactionProfile.dialogueExemplars.exemplar-source-boundary" ||
			len(item.Segments) != 2 || item.Segments[0].Role != "user" || item.Segments[1].Role != "assistant" ||
			!strings.Contains(item.Segments[0].Content, "exemplar-source-boundary") ||
			!strings.Contains(item.Segments[1].Content, "exemplar-source-boundary") {
			t.Fatalf("typed dialogue exemplar lost id or user/character roles: %+v", item)
		}
		return
	}
	t.Fatal("typed dialogue exemplar was not compiled")
}

func assertRealmSourceCompilerNarrativeDualProjectionV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem) {
	t.Helper()
	behavior := false
	knowledge := false
	for _, item := range items[agentTurnContextLaneSourceBehavior] {
		behavior = behavior || item.StableID == "source.behavior.narrative"
	}
	for _, item := range items[agentTurnContextLaneSourceKnowledge] {
		knowledge = knowledge || item.StableID == "source.knowledge.narrative.summary"
	}
	if !behavior || !knowledge {
		t.Fatalf("typed narrative dual projection behavior=%v knowledge=%v", behavior, knowledge)
	}
}

func assertRealmSourceCompilerNoOpenPayloadV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem) {
	t.Helper()
	var providerVisible strings.Builder
	for _, laneItems := range items {
		for _, item := range laneItems {
			for _, segment := range item.Segments {
				providerVisible.WriteString(segment.Content)
				providerVisible.WriteByte('\n')
			}
		}
	}
	content := providerVisible.String()
	for _, forbidden := range []string{
		"test-factory",
		"Canonical CharacterProfileCoreV1 fixture.",
		"resource-avatar-",
		"resourceRefs",
		"externalRefs",
		"sourceGrounded",
		"materializationCoverageHash",
		"profileCoverageHash",
	} {
		if strings.Contains(content, forbidden) {
			t.Fatalf("Realm source compiler serialized authoring/assets/open JSON field %q", forbidden)
		}
	}
	for _, item := range items[agentTurnContextLaneSourceBehavior] {
		if !strings.HasPrefix(item.StableID, "source.behavior.descriptive-capability.") {
			continue
		}
		for _, segment := range item.Segments {
			if !strings.Contains(segment.Content, "does not grant a Runtime tool") {
				t.Fatalf("descriptive source capability lacks non-authorizing semantics: %+v", item)
			}
		}
	}
}
