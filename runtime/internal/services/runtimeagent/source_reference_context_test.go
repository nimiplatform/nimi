package runtimeagent

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
)

func TestSourceReferenceReadUsesActualCognitionOwnerWithoutEmbedding(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	source := sourceCognitionTestTurnView(t, snapshot)
	partition := sourceCognitionTestPartition(t, snapshot)
	owner, err := cognitionservice.NewV1Owner(nil, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "runtime.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	scope := sourceCognitionScopeID(snapshot.LocalAgentRef)
	if _, err := owner.IngestAgentSource(context.Background(), "owner-1", snapshot.LocalAgentRef, scope, snapshot.SnapshotHash, partition.PartitionHash, cognitionUnitsFromPartition(partition), cognitionOmissionsFromPartition(partition)); err != nil {
		t.Fatal(err)
	}
	var text string
	for _, named := range source.NamedSourceRefs {
		matches := matchLocalAgentSourceReferencesV1(named.Name, source.SnapshotCandidateSourceRefs, source.NamedSourceRefs)
		if len(matches.Matches) != 1 || len(matches.Ambiguous) != 0 {
			continue
		}
		for _, unit := range source.CognitionUnitBindings {
			if unit.SourceRef == named.SourceRef {
				text = named.Name
				break
			}
		}
		if text != "" {
			break
		}
	}
	if text == "" {
		t.Fatal("fixture has no unique named optional source")
	}
	svc := &Service{sourceCognitionBridge: owner}
	svc.closed.Store(true)
	result := (publicChatRuntime{svc: svc}).retrieveLocalAgentSourceCognition(context.Background(), "owner-1", snapshot.LocalAgentRef, source, agentTurnCurrentUserInput{Text: text}, nil, nil, nil, publicChatAvailableActions{})
	if (result.AdapterStatus != "building" && result.AdapterStatus != "unconfigured") || result.ExactStatus != "ready" || result.SelectionStatus != "ready" || len(result.Candidates) == 0 || len(result.Candidates) > 8 {
		t.Fatalf("actual owner exact retrieval = %#v", result)
	}
	for _, candidate := range result.Candidates {
		if !agentTurnCognitionCandidateIsExact(candidate) || candidate.HasSemanticScore || candidate.Score != 0 {
			t.Fatalf("exact result pretends semantic success: %#v", candidate)
		}
	}
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.Cognition = result
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.Cognition.ExactStatus != "ready" || compiled.Manifest.Cognition.AdapterStatus != result.AdapterStatus || compiled.Manifest.Cognition.IncludedUnitCount == 0 || len(compiled.Manifest.Cognition.Selections) == 0 {
		t.Fatalf("compile erased actual selection status: %#v", compiled.Manifest.Cognition)
	}
}

func TestSourceReferenceAmbiguityDoesNotRequestOrLeakBody(t *testing.T) {
	source := sourceCognitionTestTurnView(t, agentTurnContextTestSnapshot(t, "worldCharacter"))
	a, b := source.SnapshotCandidateSourceRefs[0], source.SnapshotCandidateSourceRefs[1]
	source.NamedSourceRefs = []localAgentNamedSourceRefV1{{SourceRef: a, Name: "旧地图"}, {SourceRef: b, Name: "学院旧地图", Aliases: []string{"旧地图"}}}
	bridge := &sourceCognitionBridgeStub{searchErr: context.Canceled}
	result := (publicChatRuntime{svc: &Service{sourceCognitionBridge: bridge}}).retrieveLocalAgentSourceCognition(context.Background(), "owner", source.LocalAgentRef, source, agentTurnCurrentUserInput{Text: "把旧地图给我看"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "not_requested" || result.ExactStatus != "ambiguous" || result.SelectionStatus != "no_result" || len(result.Candidates) != 0 || len(result.Ambiguous) != 1 {
		t.Fatalf("ambiguous request reached body query: %#v", result)
	}
}

func TestSourceReferenceExactCandidatesRetainWholeUnitBudgetAndPriority(t *testing.T) {
	input := agentTurnContextTestInput(t, "worldCharacter")
	unit := sourceCognitionTestPartition(t, agentTurnContextTestSnapshot(t, "worldCharacter")).CognitionUnits[0]
	exact := agentTurnCognitionCandidateInput{UnitID: unit.StableID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: unit.SourceRef, Text: strings.Repeat("oversized exact source ", 400), Priority: unit.Priority, SelectionBasis: "alias", MatchedTerm: "第一页"}
	input.Cognition = agentTurnCognitionInput{AdapterStatus: "unconfigured", SelectionStatus: "ready", ExactStatus: "ready", CandidateCount: 1, Candidates: []agentTurnCognitionCandidateInput{exact}}
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	manifest := compiled.Manifest.Cognition
	if manifest.AdapterStatus != "unconfigured" || manifest.ExactStatus != "ready" || manifest.SelectionStatus != "no_result" || manifest.IncludedUnitCount != 0 || manifest.OmittedUnitCount != 1 || len(manifest.Selections) != 1 || manifest.Selections[0].Included || manifest.Selections[0].SemanticScore != nil {
		t.Fatalf("exact selection bypassed budget or invented score: %#v", manifest)
	}
	lane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneCognitionSource)
	if lane.UsedTokens > min(compiled.Manifest.Budget.InputBudgetTokens/16, 2048) {
		t.Fatalf("exact lane enlarged budget: %#v", lane)
	}
	items := make(map[agentTurnContextLaneID][]agentTurnContextItem)
	exact.Text = "fixed original source"
	semantic := exact
	semantic.UnitID, semantic.SelectionBasis, semantic.MatchedTerm, semantic.Score = "semantic", "embedding", "", 99
	if err := appendAgentTurnCognitionInputs(items, agentTurnCognitionInput{Candidates: []agentTurnCognitionCandidateInput{semantic, exact}}); err != nil {
		t.Fatal(err)
	}
	if items[agentTurnContextLaneCognitionSource][0].StableID != "cognition.source."+exact.UnitID {
		t.Fatal("semantic score outranked explicitly selected source")
	}
	if err := validateAgentTurnPrivateRecallInput(&agentTurnPrivateRecallInput{Query: "第一页", Status: "ready", Candidates: []agentTurnCognitionCandidateInput{exact}}); err != nil {
		t.Fatalf("private recall rejected scoreless exact source: %v", err)
	}
}

func TestSourceReferenceMetadataFailurePreservesValidBaseAndLorebook(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	base := sourceCognitionTestTurnView(t, snapshot)
	before, err := compileAgentTurnLorebookViewV1(base)
	if err != nil {
		t.Fatal(err)
	}
	// The optional projection encounters the shape observed in the persisted
	// September snapshot. Base snapshot/lorebook validation is a separate owner.
	unsupported := sourceWorldTimeModelTestSnapshotWith(t, map[string]any{"mode": "static", "flowRatio": 1, "isPaused": true, "calendar": nil, "displayFormat": nil, "pausedWorldTime": nil, "anchor": map[string]any{"realStartedAt": "2026-06-21T18:43:19.568Z", "worldStartedAt": "2026-06-21T18:43:19.568Z", "worldStartedAtDisplay": "静态历史世界"}})
	view := localAgentTurnSourceViewWithCognitionMetadataV1(base, unsupported)
	if view.CognitionMetadataStatus != "failure" || !strings.Contains(view.CognitionMetadataFailure, "static WorldCore timeModel") || len(view.NamedSourceRefs) != 0 || len(view.CognitionUnitBindings) != 0 {
		t.Fatalf("optional projection hid failure or retained partial metadata: %#v", view)
	}
	if err := validateLocalAgentTurnSourceViewV1(view); err != nil {
		t.Fatalf("optional failure invalidated base view: %v", err)
	}
	after, err := compileAgentTurnLorebookViewV1(view)
	if err != nil {
		t.Fatal(err)
	}
	beforeHash, err := hashSourceMaterializationRealmDomainV3("test.lorebook\x00", before)
	if err != nil {
		t.Fatal(err)
	}
	afterHash, err := hashSourceMaterializationRealmDomainV3("test.lorebook\x00", after)
	if err != nil || beforeHash != afterHash {
		t.Fatal("optional failure changed required lorebook")
	}
	result := (publicChatRuntime{svc: &Service{sourceCognitionBridge: &sourceCognitionBridgeStub{}}}).retrieveLocalAgentSourceCognition(context.Background(), "owner", view.LocalAgentRef, view, agentTurnCurrentUserInput{Text: "第一页"}, nil, nil, nil, publicChatAvailableActions{})
	if result.AdapterStatus != "failure" || result.ExactStatus != "failure" || result.FailureReason == "" || len(result.Candidates) != 0 {
		t.Fatalf("failed metadata leaked optional body: %#v", result)
	}
	if _, err := projectLocalAgentSourcePartitionV1(unsupported); err == nil {
		t.Fatal("new materialization projector admitted unsupported timeModel")
	}
}

func TestSourceReferenceFinalPromptKeepsExactBodyBeforeDescriptorBudgetCut(t *testing.T) {
	input := agentTurnContextTestInput(t, "worldCharacter")
	ref := sourceReferenceMatchTestRef("page")
	fact := agentTurnCognitionCandidateInput{UnitID: "page-fact", Category: "world_fact", SourcePath: "page.fact", SourceRef: ref, Text: "实际固定原文。" + strings.Repeat("正文内容 ", 70), Priority: 10, SelectionBasis: "source_ref", MatchedTerm: ref.RefID}
	assets := fact
	assets.UnitID, assets.Category, assets.SourcePath, assets.Text, assets.Priority = "page-assets", "source_asset_detail", "page.assets", strings.Repeat("asset descriptor ", 140), 1000
	evidence := assets
	evidence.UnitID, evidence.Category, evidence.SourcePath, evidence.Priority = "page-evidence", "source_evidence", "page.evidence", 900
	input.Cognition = agentTurnCognitionInput{AdapterStatus: "unconfigured", SelectionStatus: "ready", ExactStatus: "ready", CandidateCount: 3, Candidates: []agentTurnCognitionCandidateInput{fact, assets, evidence}}
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(agentTurnContextTestProviderText(compiled.ProviderPrompt), "实际固定原文。") {
		t.Fatal("final provider input omitted the exact body after descriptor ranking")
	}
	manifest := compiled.Manifest.Cognition
	if manifest.IncludedUnitCount >= 3 || manifest.OmittedUnitCount == 0 || !manifest.Selections[0].Included || manifest.Selections[0].SemanticScore != nil {
		t.Fatalf("whole-unit cut did not preserve exact body and true basis: %#v", manifest)
	}
	if agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneCognitionSource).UsedTokens > 2048 {
		t.Fatal("exact read enlarged the source budget")
	}
}
