package localservice

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPrepareLoadoutExpectedRevisionGuardsTheMutationBoundary(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	committed := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "conditional", asset).GetPrepareId(), false)
	if !strings.HasPrefix(committed.GetRevision(), "loadout-rev_") {
		t.Fatalf("committed Loadout revision = %q, want a rotated opaque revision", committed.GetRevision())
	}

	// A stale expected revision fails typed at the Prepare boundary.
	stale, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		LoadoutId: committed.GetLoadoutId(), CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: "stale", ExpectedLoadoutRevision: "loadout-rev_stale",
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
	})
	if stale != nil || status.Code(err) != codes.Aborted || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT {
		t.Fatalf("stale Prepare = resp:%+v code:%s reason:%s", stale, status.Code(err), grpcReasonForTest(err))
	}

	// Creating a new Loadout must not carry an expected record revision.
	if _, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID,
		DisplayName: "create with expected", ExpectedLoadoutRevision: committed.GetRevision(),
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("create with expected revision = %v, want InvalidArgument", err)
	}

	// A matching expected revision prepares against the observed record and
	// projects that record's revision as the prepare baseline.
	prepared, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		LoadoutId: committed.GetLoadoutId(), CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: "conditional updated", ExpectedLoadoutRevision: committed.GetRevision(),
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
	})
	if err != nil {
		t.Fatalf("matching Prepare: %v", err)
	}
	if prepared.GetProposedLoadout().GetRevision() != committed.GetRevision() {
		t.Fatalf("prepared baseline revision = %q, want observed %q", prepared.GetProposedLoadout().GetRevision(), committed.GetRevision())
	}
	updated := commitLoadoutForTest(t, svc, ctx, prepared.GetPrepareId(), false)
	if updated.GetRevision() == "" || updated.GetRevision() == committed.GetRevision() {
		t.Fatalf("Commit did not rotate the Loadout revision: before=%q after=%q", committed.GetRevision(), updated.GetRevision())
	}

	// UpdateLoadout is a Prepare+Commit wrapper over the same condition.
	if _, err := svc.UpdateLoadout(ctx, &runtimev1.UpdateLoadoutRequest{
		LoadoutId: committed.GetLoadoutId(), CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: "stale update", ExpectedLoadoutRevision: committed.GetRevision(),
	}); status.Code(err) != codes.Aborted || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT {
		t.Fatalf("stale UpdateLoadout = code:%s reason:%s", status.Code(err), grpcReasonForTest(err))
	}
	updatedAgain, err := svc.UpdateLoadout(ctx, &runtimev1.UpdateLoadoutRequest{
		LoadoutId: committed.GetLoadoutId(), CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: "conditional update", ExpectedLoadoutRevision: updated.GetRevision(),
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
	})
	if err != nil {
		t.Fatalf("matching UpdateLoadout: %v", err)
	}
	if updatedAgain.GetLoadout().GetRevision() == "" || updatedAgain.GetLoadout().GetRevision() == updated.GetRevision() {
		t.Fatalf("UpdateLoadout did not rotate the Loadout revision: before=%q after=%q", updated.GetRevision(), updatedAgain.GetLoadout().GetRevision())
	}

	// Empty expected stays backward compatible and creates project no revision.
	fresh, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: "unconditional create",
	})
	if err != nil {
		t.Fatalf("unconditional create Prepare: %v", err)
	}
	if fresh.GetProposedLoadout().GetRevision() != "" {
		t.Fatalf("new Loadout proposal carried a revision: %q", fresh.GetProposedLoadout().GetRevision())
	}
	unconditional, err := svc.PrepareLoadout(ctx, &runtimev1.PrepareLoadoutRequest{
		LoadoutId: committed.GetLoadoutId(), CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		RecipeId: capabilitydriver.LlamaEmbedGGUFRecipeID, DisplayName: "unconditional update",
		ModelAxes: []*runtimev1.LoadoutModelAxisInput{{SlotId: capabilitydriver.EmbeddingGGUFRequirementID, ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
	})
	if err != nil {
		t.Fatalf("unconditional update Prepare: %v", err)
	}
	if unconditional.GetProposedLoadout().GetRevision() != updatedAgain.GetLoadout().GetRevision() {
		t.Fatalf("unconditional prepare baseline = %q, want %q", unconditional.GetProposedLoadout().GetRevision(), updatedAgain.GetLoadout().GetRevision())
	}
}

func TestSelectLoadoutConditionConflictsReturnCurrentStateWithoutMutating(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract
	loadoutA := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "A", asset).GetPrepareId(), false)
	loadoutB := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "B", asset).GetPrepareId(), false)

	selectReq := func(loadoutID, expectedSelection, expectedCandidate string) *runtimev1.SelectLoadoutRequest {
		return &runtimev1.SelectLoadoutRequest{
			CapabilityContract: contract, LoadoutId: loadoutID, ConfirmedMachineImpact: true,
			ExpectedSelectionRevision: expectedSelection, ExpectedCandidateRevision: expectedCandidate,
		}
	}
	currentSelection := func() *runtimev1.LoadoutSelection {
		t.Helper()
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return cloneLoadoutSelection(svc.loadoutSelections[contract])
	}

	// Unconditional behavior is unchanged apart from the additive fields.
	first, err := svc.SelectLoadout(ctx, selectReq(loadoutA.GetLoadoutId(), "", ""))
	if err != nil || !first.GetApplied() || first.GetSelection().GetLoadoutId() != loadoutA.GetLoadoutId() || first.GetSelectionRevision() == "" {
		t.Fatalf("unconditional select = %+v err=%v", first, err)
	}

	// A stale selection revision reports a typed conflict with unchanged state.
	conflict, err := svc.SelectLoadout(ctx, selectReq(loadoutB.GetLoadoutId(), "loadout-selection-rev_stale", ""))
	if err != nil {
		t.Fatalf("stale selection revision must not error: %v", err)
	}
	if conflict.GetApplied() || conflict.GetReasonCode() != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT ||
		conflict.GetSelection().GetLoadoutId() != loadoutA.GetLoadoutId() || conflict.GetSelectionRevision() != first.GetSelectionRevision() {
		t.Fatalf("stale selection conflict = %+v", conflict)
	}
	if currentSelection().GetLoadoutId() != loadoutA.GetLoadoutId() {
		t.Fatalf("conflict mutated the selection: %+v", currentSelection())
	}

	// A stale candidate revision also conflicts without mutating state.
	conflict, err = svc.SelectLoadout(ctx, selectReq(loadoutB.GetLoadoutId(), "", "loadout-rev_stale"))
	if err != nil || conflict.GetApplied() || conflict.GetReasonCode() != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT ||
		conflict.GetSelection().GetLoadoutId() != loadoutA.GetLoadoutId() {
		t.Fatalf("stale candidate conflict = %+v err=%v", conflict, err)
	}
	// A missing candidate stays a typed NotFound rather than a condition conflict.
	if _, err := svc.SelectLoadout(ctx, selectReq("loadout_missing", "", "loadout-rev_any")); status.Code(err) != codes.NotFound {
		t.Fatalf("missing candidate with expected revision = %v, want NotFound", err)
	}

	// Matching selection revision applies and rotates the selection revision.
	second, err := svc.SelectLoadout(ctx, selectReq(loadoutB.GetLoadoutId(), first.GetSelectionRevision(), loadoutB.GetRevision()))
	if err != nil || !second.GetApplied() || second.GetSelection().GetLoadoutId() != loadoutB.GetLoadoutId() ||
		second.GetSelectionRevision() == "" || second.GetSelectionRevision() == first.GetSelectionRevision() {
		t.Fatalf("conditional select = %+v err=%v", second, err)
	}

	// Change away and back: the revision captured while A was selected is stale
	// once B took over, so reusing it conflicts even though A was selected before.
	back, err := svc.SelectLoadout(ctx, selectReq(loadoutA.GetLoadoutId(), first.GetSelectionRevision(), ""))
	if err != nil || back.GetApplied() || back.GetReasonCode() != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT ||
		back.GetSelection().GetLoadoutId() != loadoutB.GetLoadoutId() || back.GetSelectionRevision() != second.GetSelectionRevision() {
		t.Fatalf("change-away-and-back with stale revision = %+v err=%v", back, err)
	}
	third, err := svc.SelectLoadout(ctx, selectReq(loadoutA.GetLoadoutId(), second.GetSelectionRevision(), ""))
	if err != nil || !third.GetApplied() || third.GetSelection().GetLoadoutId() != loadoutA.GetLoadoutId() ||
		third.GetSelectionRevision() == second.GetSelectionRevision() {
		t.Fatalf("conditional select back = %+v err=%v", third, err)
	}

	// Clearing with the current revision rotates it and keeps the map entry.
	cleared, err := svc.SelectLoadout(ctx, selectReq("", third.GetSelectionRevision(), ""))
	if err != nil || !cleared.GetApplied() || cleared.GetSelection() != nil ||
		cleared.GetSelectionRevision() == "" || cleared.GetSelectionRevision() == third.GetSelectionRevision() {
		t.Fatalf("conditional clear = %+v err=%v", cleared, err)
	}
	if currentSelection() != nil {
		t.Fatalf("clear left a selection: %+v", currentSelection())
	}
	projection, err := svc.GetMachineLoadouts(ctx, &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got := projection.GetAggregate().GetSelectionRevisions()[contract]; got != cleared.GetSelectionRevision() {
		t.Fatalf("cleared selection revision projection = %q, want %q", got, cleared.GetSelectionRevision())
	}
	if got := findLoadout(projection.GetAggregate().GetLoadouts(), loadoutA.GetLoadoutId()); got == nil || got.GetRevision() != loadoutA.GetRevision() {
		t.Fatalf("GetMachineLoadouts projection lost the Loadout revision: %+v", got)
	}

	// Selection revisions survive a daemon restart.
	restarted := restartModelAssetServiceForTest(t, svc.stateStorePath, svc.localModelsPath)
	restored, err := restarted.GetMachineLoadouts(ctx, &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got := restored.GetAggregate().GetSelectionRevisions()[contract]; got != cleared.GetSelectionRevision() {
		t.Fatalf("restarted selection revision = %q, want %q", got, cleared.GetSelectionRevision())
	}
	if got := findLoadout(restored.GetAggregate().GetLoadouts(), loadoutA.GetLoadoutId()); got == nil || got.GetRevision() != loadoutA.GetRevision() {
		t.Fatalf("restarted Loadout lost its revision: %+v", got)
	}
}

func TestDeleteSelectedLoadoutRotatesTheSelectionRevision(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract
	loadout := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "selected", asset).GetPrepareId(), false)
	selected, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract: contract, LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeleteLoadout(ctx, &runtimev1.DeleteLoadoutRequest{LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true}); err != nil {
		t.Fatal(err)
	}
	projection, err := svc.GetMachineLoadouts(ctx, &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.GetAggregate().GetSelections()) != 0 {
		t.Fatalf("deleting the selected Loadout left a selection: %+v", projection.GetAggregate().GetSelections())
	}
	got := projection.GetAggregate().GetSelectionRevisions()[contract]
	if got == "" || got == selected.GetSelectionRevision() {
		t.Fatalf("deleting the selected Loadout did not rotate the selection revision: before=%q after=%q", selected.GetSelectionRevision(), got)
	}
}

func TestSelectLoadoutExpectNoPriorSelectionGuardsFirstEverSelection(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract
	loadoutA := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "A", asset).GetPrepareId(), false)
	loadoutB := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "B", asset).GetPrepareId(), false)

	firstSelection := func(loadoutID string) *runtimev1.SelectLoadoutRequest {
		return &runtimev1.SelectLoadoutRequest{
			CapabilityContract: contract, LoadoutId: loadoutID, ConfirmedMachineImpact: true,
			ExpectNoPriorSelection: true,
		}
	}

	// The no-prior-selection expectation is mutually exclusive with a non-empty
	// expected selection revision.
	exclusive := firstSelection(loadoutA.GetLoadoutId())
	exclusive.ExpectedSelectionRevision = "loadout-selection-rev_any"
	if _, err := svc.SelectLoadout(ctx, exclusive); status.Code(err) != codes.InvalidArgument ||
		grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID {
		t.Fatalf("expect_no_prior_selection with expected_selection_revision = code:%s reason:%s", status.Code(err), grpcReasonForTest(err))
	}

	// A capability with no selection revision record satisfies the expectation.
	first, err := svc.SelectLoadout(ctx, firstSelection(loadoutA.GetLoadoutId()))
	if err != nil || !first.GetApplied() || first.GetSelection().GetLoadoutId() != loadoutA.GetLoadoutId() || first.GetSelectionRevision() == "" {
		t.Fatalf("first-ever conditional select = %+v err=%v", first, err)
	}

	// A racing first selection conflicts once any selection revision record
	// exists, projects the unchanged current state, and does not overwrite it.
	race, err := svc.SelectLoadout(ctx, firstSelection(loadoutB.GetLoadoutId()))
	if err != nil {
		t.Fatalf("racing first selection must not error: %v", err)
	}
	if race.GetApplied() || race.GetReasonCode() != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT ||
		race.GetSelection().GetLoadoutId() != loadoutA.GetLoadoutId() || race.GetSelectionRevision() != first.GetSelectionRevision() {
		t.Fatalf("racing first selection conflict = %+v", race)
	}
	svc.mu.RLock()
	selectionAfterRace := cloneLoadoutSelection(svc.loadoutSelections[contract])
	revisionAfterRace := svc.loadoutSelectionRevisions[contract]
	svc.mu.RUnlock()
	if selectionAfterRace.GetLoadoutId() != loadoutA.GetLoadoutId() || revisionAfterRace != first.GetSelectionRevision() {
		t.Fatalf("racing first selection mutated state: selection=%+v revision=%q", selectionAfterRace, revisionAfterRace)
	}

	// The path without the expectation is unchanged.
	unconditional, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract: contract, LoadoutId: loadoutB.GetLoadoutId(), ConfirmedMachineImpact: true,
	})
	if err != nil || !unconditional.GetApplied() || unconditional.GetSelection().GetLoadoutId() != loadoutB.GetLoadoutId() {
		t.Fatalf("unconditional select after conflict = %+v err=%v", unconditional, err)
	}
}

func TestSelectLoadoutExpectNoPriorSelectionConflictsAfterClear(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract
	loadout := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "cleared", asset).GetPrepareId(), false)

	selected, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract: contract, LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true, ExpectNoPriorSelection: true,
	})
	if err != nil || !selected.GetApplied() {
		t.Fatalf("first-ever select = %+v err=%v", selected, err)
	}
	cleared, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract: contract, ConfirmedMachineImpact: true, ExpectedSelectionRevision: selected.GetSelectionRevision(),
	})
	if err != nil || !cleared.GetApplied() || cleared.GetSelection() != nil {
		t.Fatalf("clear = %+v err=%v", cleared, err)
	}

	// Clearing keeps the rotated revision record, so the capability still
	// counts as previously selected.
	conflict, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract: contract, LoadoutId: loadout.GetLoadoutId(), ConfirmedMachineImpact: true, ExpectNoPriorSelection: true,
	})
	if err != nil {
		t.Fatalf("post-clear first-selection conflict must not error: %v", err)
	}
	if conflict.GetApplied() || conflict.GetReasonCode() != runtimev1.ReasonCode_AI_LOADOUT_CONDITION_CONFLICT ||
		conflict.GetSelection() != nil || conflict.GetSelectionRevision() != cleared.GetSelectionRevision() {
		t.Fatalf("post-clear first-selection conflict = %+v", conflict)
	}
}
