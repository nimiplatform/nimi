package runtimeagent

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

type realmSourceCompilerOfficialExpectationV3 struct {
	PacketHash               string
	ReferenceSourceLanesHash string
	CompiledContentHash      string
	LaneItemCounts           map[agentTurnContextLaneID]int
	ItemPaths                map[string]string
	AvatarResourceRef        string
}

func TestCompileAgentTurnSourceSnapshotV3OfficialVectorsProduceReferenceEquivalentFiveLanes(t *testing.T) {
	for vectorName, want := range map[string]realmSourceCompilerOfficialExpectationV3{
		"world-character": {
			PacketHash:               "4feafc11dd697f0338874eb653c9df732fd4c45efd916eccfa3cbe2eb6508c2c",
			ReferenceSourceLanesHash: "dab0d1cbe33dfcc89584ef8dd312ac7ff1a8fa925eafba12398281982f0292c6",
			CompiledContentHash:      "6ef180fc1220efb990ec2755b4dedbe77a06a0bef5bc572f7ad93f1ea98dbf7e",
			LaneItemCounts: map[agentTurnContextLaneID]int{
				agentTurnContextLaneSourceIdentity: 3, agentTurnContextLaneSourceBehavior: 5,
				agentTurnContextLaneWorldContext: 8, agentTurnContextLaneRelationshipContext: 3,
				agentTurnContextLaneSourceKnowledge: 3,
			},
			ItemPaths:         realmSourceCompilerOfficialItemPathsV3(true),
			AvatarResourceRef: "resource-avatar-mira",
		},
		"persona-character": {
			PacketHash:               "3b08a9a1b650175372b7ca23421b3d209223b0a06f194b2b0389a43da3b3604c",
			ReferenceSourceLanesHash: "843f529e36d6bdb99b57fa929164b86dd9547d8fe0e9a156c59811a09ea6c0c2",
			CompiledContentHash:      "22b167e648782277a5285687fafae97cbac61f292654ff8964ea7f3cfa9dcde1",
			LaneItemCounts: map[agentTurnContextLaneID]int{
				agentTurnContextLaneSourceIdentity: 3, agentTurnContextLaneSourceBehavior: 5,
				agentTurnContextLaneWorldContext: 3, agentTurnContextLaneRelationshipContext: 1,
				agentTurnContextLaneSourceKnowledge: 3,
			},
			ItemPaths:         realmSourceCompilerOfficialItemPathsV3(false),
			AvatarResourceRef: "resource-avatar-solace",
		},
	} {
		vectorName, want := vectorName, want
		t.Run(vectorName, func(t *testing.T) {
			vectorCounts, vectorSourceLanesHash := realmSourceCompilerReferenceExpectationV3(t, vectorName)
			if !reflect.DeepEqual(vectorCounts, want.LaneItemCounts) || vectorSourceLanesHash != want.ReferenceSourceLanesHash {
				t.Fatalf("fixed Realm reference projection drifted: counts=%v hash=%s", vectorCounts, vectorSourceLanesHash)
			}

			verified := verifiedRealmSourceMaterializationVectorV3(t, vectorName)
			if verified.Packet.PacketHash != want.PacketHash {
				t.Fatalf("fixed Realm Packet hash = %s, want %s", verified.Packet.PacketHash, want.PacketHash)
			}
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
			if firstHash != want.CompiledContentHash {
				t.Fatalf("compiled content hash = %s, want %s", firstHash, want.CompiledContentHash)
			}

			assertRealmSourceCompilerFiveLanesV3(t, first, want.LaneItemCounts)
			assertRealmSourceCompilerOfficialPathsV3(t, first, want.ItemPaths)
			assertRealmSourceCompilerTypedItemsV3(t, snapshot, first)
			assertRealmSourceCompilerOfficialSemanticsV3(t, snapshot, first, want.AvatarResourceRef)
			assertRealmSourceCompilerExemplarV3(t, first)
			assertRealmSourceCompilerNoOpenPayloadV3(t, first)
		})
	}
}

func TestCompileRealmSourceProfileV3ProjectsBothPresentationResourceRefs(t *testing.T) {
	verified := verifiedRealmSourceMaterializationVectorV3(t, "world-character")
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(
		verified,
		realmSourceMaterializationProductTestLocalAgentRef("compiler-v3-presentation-refs"),
	)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		t.Fatal(err)
	}
	profileCover := "resource-cover-mira"
	profile.Presentation.ProfileCoverResourceRef = &profileCover
	items := make(map[agentTurnContextLaneID][]agentTurnContextItem, 5)
	if err := compileRealmSourceProfileV3(snapshot, profile, items); err != nil {
		t.Fatal(err)
	}
	presentation := realmSourceCompilerItemByIDV3(t, items, "source.presentation")
	content := realmSourceCompilerItemContentV3(presentation)
	for _, value := range []string{"avatar_resource_ref=\"resource-avatar-mira\"", "profile_cover_resource_ref=\"resource-cover-mira\""} {
		if !strings.Contains(content, value) {
			t.Fatalf("presentation resource projection omitted %q: %s", value, content)
		}
	}
}

func TestCompileRealmSourceClosureV3RecordsNoRelationshipsAsNonProviderOmission(t *testing.T) {
	verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(
		verified,
		realmSourceMaterializationProductTestLocalAgentRef("compiler-v3-no-relationships"),
	)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		t.Fatal(err)
	}
	noRelationships := []realmSourceCompilerProfileRelationshipV3{}
	profile.Relationships = &noRelationships
	items := make(map[agentTurnContextLaneID][]agentTurnContextItem, 5)
	if err := compileRealmSourceProfileV3(snapshot, profile, items); err != nil {
		t.Fatal(err)
	}
	if err := compileRealmSourceClosureV3(snapshot, items); err != nil {
		t.Fatal(err)
	}
	relationshipItems := items[agentTurnContextLaneRelationshipContext]
	if len(relationshipItems) != 1 {
		t.Fatalf("relationship omission records = %d, want 1", len(relationshipItems))
	}
	omission := relationshipItems[0]
	if omission.StableID != "source.relationship.none" || omission.SourcePath != "semanticPayload.canonicalSource.profile.relationships" ||
		omission.OmissionReason != "no_source_or_closure_relationships" || omission.Included || omission.Truncated ||
		omission.TokenEstimate != 0 || len(omission.Segments) != 0 || len(omission.Media) != 0 || !isLowerSHA256V3(omission.ContentHash) {
		t.Fatalf("invalid no-relationship omission record: %+v", omission)
	}
	if omission.ContentHash != "6eb13be42b17ff9f0b884338da2056c015d449e9acce09192035f2acb3b78eeb" {
		t.Fatalf("no-relationship omission hash = %s", omission.ContentHash)
	}
	lanes, err := makeAgentTurnContextLanes(items)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applyAgentTurnContextBudget(lanes, agentTurnContextBudgetInput{ContextWindowTokens: 1_000_000}); err != nil {
		t.Fatal(err)
	}
	foundRelationshipLane := false
	for _, lane := range lanes {
		if lane.LaneID != agentTurnContextLaneRelationshipContext {
			continue
		}
		foundRelationshipLane = true
		if lane.IncludedItemCount != 0 || lane.OmittedItemCount != 1 || lane.TruncatedCount != 0 ||
			len(agentTurnContextProviderMessagesForItem(lane.Items[0])) != 0 {
			t.Fatalf("relationship omission became provider content: %+v", lane)
		}
	}
	if !foundRelationshipLane {
		t.Fatal("relationship lane missing")
	}
	manifest, err := buildAgentTurnContextLaneManifest(lanes)
	if err != nil {
		t.Fatal(err)
	}
	for _, lane := range manifest {
		if lane.LaneID != agentTurnContextLaneRelationshipContext {
			continue
		}
		if len(lane.Omissions) != 1 || lane.Omissions[0].StableID != omission.StableID ||
			lane.Omissions[0].SourcePath != omission.SourcePath || lane.Omissions[0].ContentHash != omission.ContentHash ||
			lane.Omissions[0].OmissionReason != omission.OmissionReason {
			t.Fatalf("relationship omission is absent from the internal manifest: %+v", lane.Omissions)
		}
		if len(lane.SourceRefs) != 1 || !reflect.DeepEqual(lane.SourceRefs[0], omission.SourceRef) {
			t.Fatalf("relationship omission lost its typed source ref: %+v", lane.SourceRefs)
		}
	}
	malformed, err := makeAgentTurnContextLanes(items)
	if err != nil {
		t.Fatal(err)
	}
	for laneIndex := range malformed {
		if malformed[laneIndex].LaneID == agentTurnContextLaneRelationshipContext {
			malformed[laneIndex].Items[0].Segments = []agentTurnContextSegment{{Role: "system", Content: "hidden omission payload"}}
		}
	}
	if _, err := applyAgentTurnContextBudget(malformed, agentTurnContextBudgetInput{ContextWindowTokens: 1_000_000}); err == nil {
		t.Fatal("malformed omission record with provider content was admitted")
	}
}

func TestCompileRealmSourceClosureV3KeepsDependencyRelationshipsBudgetTruncatable(t *testing.T) {
	t.Parallel()
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	items, err := compileAgentTurnSourceSnapshotV3(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	lanes, err := makeAgentTurnContextLanes(items)
	if err != nil {
		t.Fatal(err)
	}

	var required uint64
	for _, lane := range lanes {
		for _, item := range lane.Items {
			if item.Mandatory {
				required += item.TokenEstimate
			}
		}
	}
	if required == 0 {
		t.Fatal("source fixture has no mandatory baseline")
	}
	if _, err := applyAgentTurnContextBudget(lanes, agentTurnContextBudgetInput{ContextWindowTokens: required}); err != nil {
		t.Fatal(err)
	}

	relationshipLane := agentTurnContextTestLane(t, lanes, agentTurnContextLaneRelationshipContext)
	var profileIncluded, closureTruncated bool
	for _, item := range relationshipLane.Items {
		switch {
		case strings.HasPrefix(item.StableID, "source.relationship.profile."):
			profileIncluded = profileIncluded || item.Mandatory && item.Included && !item.Truncated &&
				item.TruncationClass == agentTurnContextTruncationNone
		case strings.HasPrefix(item.StableID, "source.relationship.world."):
			if item.Mandatory || item.TruncationClass != agentTurnContextTruncationWorldDetail {
				t.Fatalf("dependency-closure relationship is not optional world detail: %+v", item)
			}
			closureTruncated = closureTruncated || !item.Included && item.Truncated
		}
	}
	if !profileIncluded || !closureTruncated {
		t.Fatalf("relationship budget posture mismatch: profile_included=%t closure_truncated=%t lane=%+v",
			profileIncluded, closureTruncated, relationshipLane)
	}
}

func realmSourceCompilerReferenceExpectationV3(t *testing.T, vectorName string) (map[agentTurnContextLaneID]int, string) {
	t.Helper()
	raw, err := os.ReadFile(sourceMaterializationReferenceVectorPathV3(t, vectorName))
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Expected struct {
			SourceLanesHash string         `json:"sourceLanesHash"`
			LaneItemCounts  map[string]int `json:"laneItemCounts"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(raw, &vector); err != nil {
		t.Fatal(err)
	}
	counts := make(map[agentTurnContextLaneID]int, len(vector.Expected.LaneItemCounts))
	for laneID, count := range vector.Expected.LaneItemCounts {
		counts[agentTurnContextLaneID(laneID)] = count
	}
	return counts, vector.Expected.SourceLanesHash
}

func realmSourceCompilerOfficialItemPathsV3(worldCharacter bool) map[string]string {
	paths := map[string]string{
		"source.identity":                                           "semanticPayload.canonicalSource.profile.identity",
		"source.presentation":                                       "semanticPayload.canonicalSource.profile.presentation",
		"source.asset-intents":                                      "semanticPayload.canonicalSource.profile.assets",
		"source.behavior.narrative":                                 "semanticPayload.canonicalSource.profile.narrative",
		"source.behavior.interaction":                               "semanticPayload.canonicalSource.profile.interactionProfile",
		"source.behavior.psychology":                                "semanticPayload.canonicalSource.profile.psychology",
		"source.behavior.descriptive-capabilities":                  "semanticPayload.canonicalSource.profile.capabilities",
		"source.behavior.exemplar.exemplar-source-boundary":         "semanticPayload.canonicalSource.profile.interactionProfile.dialogueExemplars.exemplar-source-boundary",
		"source.relationship.profile.relationship-explicit-council": "semanticPayload.canonicalSource.profile.relationships.relationship-explicit-council",
		"source.knowledge.narrative":                                "semanticPayload.canonicalSource.profile.narrative",
		"source.knowledge.typed":                                    "semanticPayload.canonicalSource.profile.knowledge",
		"source.knowledge.milestone.milestone-oath":                 "semanticPayload.canonicalSource.profile.narrative.milestones.milestone-oath",
		"source.world.baseline":                                     "semanticPayload.materializationContext.owningWorld.core",
		"source.world.system.archive-law":                           "semanticPayload.materializationContext.owningWorld.core.system.archive-law",
		"source.world.scene.scene-archive":                          "semanticPayload.materializationContext.owningWorld.core.scene.scene-archive",
	}
	if !worldCharacter {
		return paths
	}
	paths["source.world.character-placement"] = "sourceRef.worldEntityRef"
	for _, entityID := range []string{"entity-bound", "entity-alpha", "entity-explicit", "entity-zeta"} {
		paths["source.world.entity."+entityID] = "semanticPayload.materializationContext.dependencyClosure.entities." + entityID
	}
	for _, relationshipID := range []string{"relationship-alpha", "relationship-zeta"} {
		paths["source.relationship.world."+relationshipID] = "semanticPayload.materializationContext.dependencyClosure.relationships." + relationshipID
	}
	return paths
}

func assertRealmSourceCompilerFiveLanesV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem, expected ...map[agentTurnContextLaneID]int) {
	t.Helper()
	want := map[agentTurnContextLaneID]int{
		agentTurnContextLaneSourceIdentity: -1, agentTurnContextLaneSourceBehavior: -1,
		agentTurnContextLaneWorldContext: -1, agentTurnContextLaneRelationshipContext: -1,
		agentTurnContextLaneSourceKnowledge: -1,
	}
	if len(expected) > 0 {
		want = expected[0]
	}
	if len(items) != len(want) {
		t.Fatalf("source compiler lane count = %d, want %d", len(items), len(want))
	}
	for laneID, count := range want {
		if count >= 0 && len(items[laneID]) != count {
			t.Fatalf("source compiler lane %q item count = %d, want %d", laneID, len(items[laneID]), count)
		}
		if count < 0 && len(items[laneID]) == 0 {
			t.Fatalf("source compiler lane %q is empty", laneID)
		}
	}
	if len(items[agentTurnContextLaneCapabilityContext]) != 0 {
		t.Fatal("descriptive Realm source capabilities became Runtime capability/tool authority")
	}
}

func assertRealmSourceCompilerOfficialPathsV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem, want map[string]string) {
	t.Helper()
	seen := make(map[string]struct{}, len(want))
	for _, laneItems := range items {
		for _, item := range laneItems {
			wantPath, admitted := want[item.StableID]
			if !admitted {
				t.Fatalf("compiler emitted non-reference item %q at %q", item.StableID, item.SourcePath)
			}
			if item.SourcePath != wantPath {
				t.Fatalf("item %q path = %q, want %q", item.StableID, item.SourcePath, wantPath)
			}
			seen[item.StableID] = struct{}{}
		}
	}
	if len(seen) != len(want) {
		t.Fatalf("reference path coverage = %d/%d", len(seen), len(want))
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
				!isLowerSHA256V3(item.ContentHash) || item.Priority == 0 ||
				item.AuthorityOwner != agentTurnContextAuthorityRealmSnapshot || item.TrustClass != agentTurnContextTrustValidatedSource {
				t.Fatalf("invalid typed Realm source item: %+v", item)
			}
			if item.OmissionReason == "" && item.TokenEstimate == 0 {
				t.Fatalf("included Realm source item has zero tokens: %+v", item)
			}
			if item.OmissionReason != "" && (item.TokenEstimate != 0 || item.Included || len(item.Segments) != 0) {
				t.Fatalf("Realm source omission is provider-visible: %+v", item)
			}
			identity := string(laneID) + "\x00" + item.StableID
			if _, duplicate := seen[identity]; duplicate {
				t.Fatalf("duplicate stable Realm source item %q", identity)
			}
			seen[identity] = struct{}{}
			if strings.HasPrefix(item.StableID, "source.identity") || strings.HasPrefix(item.StableID, "source.presentation") ||
				strings.HasPrefix(item.StableID, "source.asset-intents") || strings.HasPrefix(item.StableID, "source.behavior.") ||
				strings.HasPrefix(item.StableID, "source.knowledge.") || strings.HasPrefix(item.StableID, "source.relationship.profile.") {
				if item.SourceRef.Kind != snapshot.Semantic.SourceRef.Kind || item.SourceRef.RefID != snapshot.Semantic.SourceRef.ID {
					t.Fatalf("profile item lost CharacterSourceRefV3 binding: %+v", item.SourceRef)
				}
			}
		}
	}
}

func assertRealmSourceCompilerOfficialSemanticsV3(t *testing.T, snapshot localAgentSourceSnapshotV2, items map[agentTurnContextLaneID][]agentTurnContextItem, avatarResourceRef string) {
	t.Helper()
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		t.Fatal(err)
	}
	if profile.InteractionProfile.Greeting == nil || *profile.InteractionProfile.Greeting != "Welcome. Which record should we examine?" ||
		profile.InteractionProfile.GreetingVariants == nil || !reflect.DeepEqual(*profile.InteractionProfile.GreetingVariants, []string{"The archive is open."}) {
		t.Fatalf("SnapshotV2 did not retain proof-covered new-conversation greeting data: %+v", profile.InteractionProfile)
	}
	presentation := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.presentation"))
	assets := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.asset-intents"))
	world := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.world.baseline"))
	interaction := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.behavior.interaction"))
	knowledge := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.knowledge.typed"))
	relationship := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.relationship.profile.relationship-explicit-council"))
	for label, value := range map[string]string{
		"presentation avatar": "avatar_resource_ref=\"" + avatarResourceRef + "\"",
		"asset resource":      avatarResourceRef + ":image:avatar",
		"asset intent":        "intent-voice:voice:Measured archival voice.",
	} {
		if !strings.Contains(presentation+"\n"+assets, value) {
			t.Fatalf("%s projection omitted %q", label, value)
		}
	}
	if !strings.Contains(world, "tagline=\"Test WorldCore test WorldCore.\"") {
		t.Fatalf("WorldCore presentation tagline fallback was lost: %s", world)
	}
	for _, value := range []string{"topics=\"World chronology\"", "constraints=\"Unknown events remain unknown\""} {
		if !strings.Contains(knowledge, value) {
			t.Fatalf("typed source knowledge omitted %q: %s", value, knowledge)
		}
	}
	if !strings.Contains(relationship, "relationship_id=\"relationship-explicit-council\"") {
		t.Fatalf("profile relationship omitted its fixed Realm relationship id: %s", relationship)
	}
	for _, forbidden := range []string{"greeting=", "greeting_variants=", "Welcome. Which record should we examine?", "The archive is open."} {
		if strings.Contains(interaction, forbidden) {
			t.Fatalf("new-conversation greeting leaked into every turn as %q: %s", forbidden, interaction)
		}
	}
	if snapshot.Semantic.SourceRef.Kind == "worldCharacter" {
		placement := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.world.character-placement"))
		for _, value := range []string{"world_id=\"world-materialization-v3\"", "entity_id=\"entity-bound\"", "entity_kind=\"worldEntity\""} {
			if !strings.Contains(placement, value) {
				t.Fatalf("WorldCharacter placement omitted %q: %s", value, placement)
			}
		}
	}
}

func assertRealmSourceCompilerExemplarV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem) {
	t.Helper()
	item := realmSourceCompilerItemByIDV3(t, items, "source.behavior.exemplar.exemplar-source-boundary")
	if item.SourcePath != "semanticPayload.canonicalSource.profile.interactionProfile.dialogueExemplars.exemplar-source-boundary" ||
		len(item.Segments) != 2 || item.Segments[0].Role != "user" || item.Segments[1].Role != "assistant" ||
		!strings.Contains(item.Segments[0].Content, "exemplar-source-boundary") ||
		!strings.Contains(item.Segments[1].Content, "exemplar-source-boundary") {
		t.Fatalf("typed dialogue exemplar lost id or user/character roles: %+v", item)
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
		"sourceGrounded",
		"materializationCoverageHash",
		"profileCoverageHash",
		"https://",
	} {
		if strings.Contains(content, forbidden) {
			t.Fatalf("Realm source compiler serialized open authoring/transport field %q", forbidden)
		}
	}
	capabilities := realmSourceCompilerItemContentV3(realmSourceCompilerItemByIDV3(t, items, "source.behavior.descriptive-capabilities"))
	if !strings.Contains(capabilities, "grant no Runtime tool") {
		t.Fatalf("descriptive source capabilities lack non-authorizing semantics: %s", capabilities)
	}
}

func realmSourceCompilerItemByIDV3(t *testing.T, items map[agentTurnContextLaneID][]agentTurnContextItem, stableID string) agentTurnContextItem {
	t.Helper()
	for _, laneItems := range items {
		for _, item := range laneItems {
			if item.StableID == stableID {
				return item
			}
		}
	}
	t.Fatalf("Realm source compiler item %q missing", stableID)
	return agentTurnContextItem{}
}

func realmSourceCompilerItemContentV3(item agentTurnContextItem) string {
	var content strings.Builder
	for _, segment := range item.Segments {
		content.WriteString(segment.Content)
		content.WriteByte('\n')
	}
	return content.String()
}
