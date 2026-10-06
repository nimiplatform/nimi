package cognition

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
)

type RuntimeSourceUnitBinding struct {
	UnitID      string
	ContentHash string
}

type RuntimeSourceSelection struct {
	SourceRef RuntimeSourceRef
	Basis     string
	Term      string
	Units     []RuntimeSourceUnitBinding
}

type RuntimeSourceReferenceRead struct {
	ScopeID           string
	SnapshotIdentity  string
	PartitionIdentity string
	UnitCount         uint32
	OmissionCount     uint32
	Selections        []RuntimeSourceSelection
	Limit             int
}

// Runtime keeps this opaque identity in its compact snapshot metadata, never
// a second copy of the body. Embedding state and retrieval score are excluded.
func RuntimeSourceUnitContentHash(unit RuntimeSourceUnit) string {
	content := struct {
		UnitID         string
		Category       string
		SourcePath     string
		SourceRef      RuntimeSourceRef
		Text           string
		ProvenanceRefs []string
		Priority       int64
	}{unit.UnitID, unit.Category, unit.SourcePath, unit.SourceRef, unit.Text, append([]string{}, unit.ProvenanceRefs...), unit.Priority}
	raw, _ := json.Marshal(content)
	hash := sha256.Sum256(append([]byte("nimi.cognition.runtime-source-unit/v1\x00"), raw...))
	return hex.EncodeToString(hash[:])
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r013
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r014
func (s *RuntimeSourceBridge) ReadAgentSourceReferences(_ context.Context, auth RuntimeAuthorization, request RuntimeSourceReferenceRead) (RuntimeSourceOutcome, error) {
	if err := s.validateRuntimeAuthorization(auth, RuntimeBridgeOperationSearchAgentSource, request.ScopeID, RuntimeAuthorizationActionSearchAgentSource); err != nil {
		return RuntimeSourceOutcome{}, err
	}
	if !runtimeSourceSHA256(request.SnapshotIdentity) || !runtimeSourceSHA256(request.PartitionIdentity) || len(request.Selections) == 0 || len(request.Selections) > 8 || request.Limit <= 0 || request.Limit > 12 {
		return RuntimeSourceOutcome{}, errors.New("runtime source bridge: exact source request is invalid")
	}
	refs := make([]storage.RuntimeSourceRef, 0, len(request.Selections))
	selections := make(map[RuntimeSourceRef]RuntimeSourceSelection)
	expected := make(map[string]RuntimeSourceUnitBinding)
	expectedRefs := make(map[string]RuntimeSourceRef)
	for _, selection := range request.Selections {
		if !validRuntimeSourceRef(selection.SourceRef) || (selection.Basis != "source_ref" && selection.Basis != "name" && selection.Basis != "alias") || strings.TrimSpace(selection.Term) == "" || strings.TrimSpace(selection.Term) != selection.Term || !utf8.ValidString(selection.Term) || len(selection.Term) > 4096 || selection.Units == nil {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: exact source selection is invalid")
		}
		if _, duplicate := selections[selection.SourceRef]; duplicate {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: duplicate exact source selection")
		}
		selections[selection.SourceRef] = selection
		ref := selection.SourceRef
		refs = append(refs, storage.RuntimeSourceRef{Kind: ref.Kind, WorldID: ref.WorldID, RefID: ref.RefID, SchemaVersion: ref.SchemaVersion, ContentHash: ref.ContentHash})
		for _, binding := range selection.Units {
			if strings.TrimSpace(binding.UnitID) == "" || strings.TrimSpace(binding.UnitID) != binding.UnitID || !runtimeSourceSHA256(binding.ContentHash) {
				return RuntimeSourceOutcome{}, errors.New("runtime source bridge: exact source unit binding is invalid")
			}
			if _, duplicate := expected[binding.UnitID]; duplicate {
				return RuntimeSourceOutcome{}, errors.New("runtime source bridge: duplicate exact source unit binding")
			}
			expected[binding.UnitID] = binding
			expectedRefs[binding.UnitID] = selection.SourceRef
		}
	}
	stored, state, err := s.store.ReadRuntimeSourceReferences(request.ScopeID, request.SnapshotIdentity, request.PartitionIdentity, refs)
	if err != nil {
		return RuntimeSourceOutcome{}, fmt.Errorf("runtime source bridge: read exact source: %w", err)
	}
	if uint32(state.UnitCount) != request.UnitCount || uint32(state.OmissionCount) != request.OmissionCount || len(stored) != len(expected) {
		return RuntimeSourceOutcome{}, errors.New("runtime source bridge: exact source coverage mismatch")
	}
	out := runtimeSourceOutcomeFromState(state)
	for _, unit := range stored {
		ref := RuntimeSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}
		selection := selections[ref]
		projected := RuntimeSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: ref, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, SelectionBasis: selection.Basis, MatchedTerm: selection.Term}
		binding, present := expected[unit.UnitID]
		if !present || expectedRefs[unit.UnitID] != ref || binding.ContentHash != RuntimeSourceUnitContentHash(projected) {
			return RuntimeSourceOutcome{}, errors.New("runtime source bridge: exact source content binding mismatch")
		}
		out.Units = append(out.Units, projected)
	}
	sort.Slice(out.Units, func(i, j int) bool {
		iDescriptor, jDescriptor := runtimeSourceExactDescriptor(out.Units[i].Category), runtimeSourceExactDescriptor(out.Units[j].Category)
		if iDescriptor != jDescriptor {
			return !iDescriptor
		}
		if out.Units[i].Priority != out.Units[j].Priority {
			return out.Units[i].Priority > out.Units[j].Priority
		}
		return out.Units[i].UnitID < out.Units[j].UnitID
	})
	out.ExactStatus = "ready"
	if len(out.Units) == 0 {
		out.ExactStatus = "no_hits"
	}
	if len(out.Units) > request.Limit {
		out.Units = out.Units[:request.Limit]
	}
	return out, nil
}

func runtimeSourceExactDescriptor(category string) bool {
	return category == "source_asset_detail" || category == "source_evidence"
}
