package runtimeagent

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func sourceReferenceMatchTestRef(id string) agentTurnContextItemSourceRef {
	return agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: "world", RefID: "world:" + id, SchemaVersion: "entity/v1", ContentHash: strings.Repeat("a", 64)}
}

func TestSourceReferenceMatchingUsesOnlyExplicitIdentifiers(t *testing.T) {
	ref := sourceReferenceMatchTestRef("page")
	names := []localAgentNamedSourceRefV1{{SourceRef: ref, Name: "星图第一页", Aliases: []string{"第一页"}}}
	for _, test := range []struct {
		text  string
		basis string
	}{
		{"请展开星图第一页的原文", "name"},
		{"我愿意读，先把第一页展开", "alias"},
		{"请读world:page里的固定正文", "source_ref"},
		{"请读world:page-copy里的固定正文", ""},
		{"给我看看正文", ""},
	} {
		t.Run(test.text, func(t *testing.T) {
			result := matchLocalAgentSourceReferencesV1(test.text, []agentTurnContextItemSourceRef{ref}, names)
			if test.basis == "" {
				if len(result.Matches) != 0 {
					t.Fatalf("inferred undeclared reference: %#v", result)
				}
				return
			}
			if len(result.Matches) != 1 || result.Matches[0].Basis != test.basis || result.Matches[0].SourceRef != ref {
				t.Fatalf("reference evidence = %#v", result)
			}
		})
	}
}

func TestSourceReferenceMatchingPreservesAliasAmbiguity(t *testing.T) {
	a, b := sourceReferenceMatchTestRef("first"), sourceReferenceMatchTestRef("other")
	names := []localAgentNamedSourceRefV1{
		{SourceRef: a, Name: "星图第一页", Aliases: []string{"第一页"}},
		{SourceRef: b, Name: "旧册第一页", Aliases: []string{"第一页"}},
	}
	result := matchLocalAgentSourceReferencesV1("先读第一页", []agentTurnContextItemSourceRef{a, b}, names)
	if len(result.Matches) != 0 || len(result.Ambiguous) != 1 || len(result.Ambiguous[0].Refs) != 2 {
		t.Fatalf("ambiguous alias selected a document: %#v", result)
	}
	result = matchLocalAgentSourceReferencesV1("请读world:first里的第一页", []agentTurnContextItemSourceRef{a, b}, names)
	if len(result.Matches) != 1 || result.Matches[0].SourceRef != a || result.Matches[0].Basis != "source_ref" || len(result.Ambiguous) != 0 {
		t.Fatalf("explicit reference did not disambiguate: %#v", result)
	}
}

func TestSourceReferenceMatchingPreservesNameAliasAmbiguity(t *testing.T) {
	a, b := sourceReferenceMatchTestRef("old-map"), sourceReferenceMatchTestRef("school-map")
	names := []localAgentNamedSourceRefV1{
		{SourceRef: a, Name: "旧地图"},
		{SourceRef: b, Name: "学院旧地图", Aliases: []string{"旧地图"}},
	}
	result := matchLocalAgentSourceReferencesV1("把旧地图给我看", []agentTurnContextItemSourceRef{a, b}, names)
	if len(result.Matches) != 0 || len(result.Ambiguous) != 1 || result.Ambiguous[0].Term != "旧地图" || len(result.Ambiguous[0].Refs) != 2 {
		t.Fatalf("formal name overrode another source's explicit alias: %#v", result)
	}
}

func TestSourceReferenceMatchingPreservesSharedRefIDAmbiguity(t *testing.T) {
	entity := sourceReferenceMatchTestRef("character")
	character := entity
	character.Kind = "worldCharacter"
	character.SchemaVersion = "character/v1"
	character.ContentHash = strings.Repeat("b", 64)
	for _, refs := range [][]agentTurnContextItemSourceRef{{entity, character}, {character, entity}} {
		result := matchLocalAgentSourceReferencesV1("请读world:character里的资料", refs, nil)
		if len(result.Matches) != 0 || len(result.Ambiguous) != 1 || result.Ambiguous[0].Term != entity.RefID || len(result.Ambiguous[0].Refs) != 2 {
			t.Fatalf("bare RefID selected distinct source tuples: %#v", result)
		}
		if !slices.Contains(result.Ambiguous[0].Refs, entity) || !slices.Contains(result.Ambiguous[0].Refs, character) {
			t.Fatalf("shared RefID ambiguity lost a source tuple: %#v", result)
		}
	}
}

func TestSourceReferenceMatchingKeepsStableEqualLengthAliasEvidence(t *testing.T) {
	ref := sourceReferenceMatchTestRef("map")
	for _, aliases := range [][]string{{"East", "West"}, {"West", "East"}} {
		names := []localAgentNamedSourceRefV1{{SourceRef: ref, Name: "Warehouse map", Aliases: aliases}}
		for attempt := 0; attempt < 128; attempt++ {
			result := matchLocalAgentSourceReferencesV1("Read East and West", []agentTurnContextItemSourceRef{ref}, names)
			if len(result.Matches) != 1 || result.Matches[0].SourceRef != ref || result.Matches[0].Basis != "alias" || result.Matches[0].Term != "East" {
				t.Fatalf("equal-length alias evidence changed with traversal: %#v", result)
			}
		}
	}
}

func TestSourceReferenceMatchingDoesNotAcceptForeignMetadataOrPartialASCIINames(t *testing.T) {
	ref, foreign := sourceReferenceMatchTestRef("local"), sourceReferenceMatchTestRef("foreign")
	names := []localAgentNamedSourceRefV1{{SourceRef: ref, Name: "Ann"}, {SourceRef: foreign, Name: "外来文书"}}
	for _, text := range []string{"Annual review", "读外来文书", "读world:foreign"} {
		if result := matchLocalAgentSourceReferencesV1(text, []agentTurnContextItemSourceRef{ref}, names); len(result.Matches) != 0 {
			t.Fatalf("invalid scope/name match for %q: %#v", text, result)
		}
	}
	if result := matchLocalAgentSourceReferencesV1("Ask Ann", []agentTurnContextItemSourceRef{ref}, names); len(result.Matches) != 1 {
		t.Fatalf("full ASCII name missing: %#v", result)
	}
}

func TestSourceReferenceMatchingDoesNotSilentlyChooseAnOverBroadPrefix(t *testing.T) {
	var refs []agentTurnContextItemSourceRef
	var terms []string
	for index := 0; index <= publicChatSourceCognitionSelectedLimit; index++ {
		ref := sourceReferenceMatchTestRef(fmt.Sprintf("doc%d", index))
		refs = append(refs, ref)
		terms = append(terms, ref.RefID)
	}
	result := matchLocalAgentSourceReferencesV1(strings.Join(terms, " "), refs, nil)
	if !result.OverLimit || len(result.Matches) != 0 {
		t.Fatalf("over-broad exact request was partially selected: %#v", result)
	}
}

func TestTurnSourceNameMetadataHydratesWithinUnchangedSnapshotMembership(t *testing.T) {
	snapshot := agentTurnContextTestSnapshot(t, "worldCharacter")
	before, err := canonicalizeSourceMaterializationRealmV3(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	view, err := localAgentTurnSourceViewFromSnapshotV1(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.NamedSourceRefs) == 0 {
		t.Fatal("snapshot names were not hydrated")
	}
	for _, named := range view.NamedSourceRefs {
		if !slices.Contains(view.SnapshotCandidateSourceRefs, named.SourceRef) {
			t.Fatalf("name is outside immutable snapshot: %#v", named)
		}
	}
	after, err := canonicalizeSourceMaterializationRealmV3(snapshot)
	if err != nil || string(before) != string(after) || view.SnapshotHash != snapshot.SnapshotHash {
		t.Fatal("identifier hydration modified immutable source")
	}
	view.NamedSourceRefs[0].SourceRef.ContentHash = strings.Repeat("b", 64)
	if err := validateLocalAgentTurnSourceCognitionMetadataV1(view); err == nil {
		t.Fatal("tampered name/hash membership was admitted")
	}
}
