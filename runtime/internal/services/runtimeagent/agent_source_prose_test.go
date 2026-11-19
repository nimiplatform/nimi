package runtimeagent

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSourceProsePreservesCompleteRangedPassagesAndOriginalBoundary(t *testing.T) {
	ref := agentTurnContextItemSourceRef{Kind: "worldCore", RefID: "space", WorldID: "space", SchemaVersion: "realm.world-core/v1", ContentHash: strings.Repeat("a", 64)}
	base := localAgentCognitionSourceUnitV1{StableID: "source.world.setting", Category: "world_setting_detail", SourcePath: "semanticPayload.materializationContext.owningWorld.core.narrative.setting", SourceRef: ref}
	sentence := "守门人轻轻问：“记得那盏灯吗？”"
	long := strings.Repeat("灯", 1000)
	original := strings.Repeat(sentence, 50) + "\n\n" + long + "。\n测得 0.04 毫米。"
	p := localAgentSourcePartitionV1{}
	err := appendLocalAgentSourceProse(&p, map[string]localAgentCognitionSourceUnitV1{}, map[string]struct{}{}, base, "Owning world setting", "setting", original)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.CognitionUnits) < 3 || len(p.Omissions) != 1 || p.Omissions[0].OmissionReason != "source_sentence_exceeds_turn_budget" {
		t.Fatalf("invalid coverage: %d units, omissions %v", len(p.CognitionUnits), p.Omissions)
	}
	var recovered strings.Builder
	for _, unit := range p.CognitionUnits {
		var a, b int
		if _, e := fmt.Sscanf(strings.TrimPrefix(unit.SourcePath, base.SourcePath), "#utf8[%d:%d]", &a, &b); e != nil {
			t.Fatal(e)
		}
		slice := original[a:b]
		if !utf8.ValidString(slice) || unit.SourceRef != ref || unit.Text != agentTurnContextTypedContent("Owning world setting", agentTurnContextTextField{Name: "setting", Values: []string{slice}}) {
			t.Fatal("source byte range differs")
		}
		recovered.WriteString(slice)
	}
	if recovered.String() != strings.Repeat(sentence, 50)+"测得 0.04 毫米。" {
		t.Fatal("unexpected partial, duplicate or missing source")
	}
}

func TestSourceProsePreservesMultilingualSentences(t *testing.T) {
	const path = "semanticPayload.materializationContext.owningWorld.core.narrative.setting"
	ref := agentTurnContextItemSourceRef{Kind: "worldCore", RefID: "space", WorldID: "space", SchemaVersion: "realm.world-core/v1", ContentHash: strings.Repeat("a", 64)}
	base := localAgentCognitionSourceUnitV1{StableID: "source.world.setting", Category: "world_setting_detail", SourcePath: path, SourceRef: ref}
	for _, tc := range []struct{ name, sentence string }{
		{"Arabic question", "متى وصل المسافر إلى المدينة؟"},
		{"quoted Arabic questions", "«متى وصل المسافر إلى المدينة؟؟»"},
		{"Hindi danda", "यात्री आज नगर पहुँचा।"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original := strings.TrimSpace(strings.Repeat(tc.sentence+" ", 64))
			var partition localAgentSourcePartitionV1
			if err := appendLocalAgentSourceProse(&partition, map[string]localAgentCognitionSourceUnitV1{}, map[string]struct{}{}, base, "Owning world setting", "setting", original); err != nil {
				t.Fatal(err)
			}
			if len(partition.Omissions) != 0 || len(partition.CognitionUnits) < 2 {
				t.Fatalf("got %d passages and %d omissions", len(partition.CognitionUnits), len(partition.Omissions))
			}
			var passages []string
			for _, unit := range partition.CognitionUnits {
				var start, end int
				if _, err := fmt.Sscanf(strings.TrimPrefix(unit.SourcePath, path), "#utf8[%d:%d]", &start, &end); err != nil || start < 0 || start >= end || end > len(original) {
					t.Fatalf("invalid passage range %q", unit.SourcePath)
				}
				passage := original[start:end]
				if !strings.HasSuffix(passage, tc.sentence) || unit.Text != agentTurnContextTypedContent("Owning world setting", agentTurnContextTextField{Name: "setting", Values: []string{passage}}) {
					t.Fatalf("incomplete sentence or mismatched source text at %s", unit.SourcePath)
				}
				passages = append(passages, passage)
			}
			if strings.Join(passages, " ") != original {
				t.Fatal("passages did not preserve the original sentences in order")
			}
		})
	}
}

func TestCognitionBudgetRetainsLowerRankedWholeUnitThatFits(t *testing.T) {
	ls := []agentTurnContextLane{{LaneID: agentTurnContextLaneCognitionSource, Items: []agentTurnContextItem{{StableID: "first", AuthorityOwner: agentTurnContextAuthorityCognitionSource, Rank: 3, TokenEstimate: 65, Included: true}, {StableID: "large", AuthorityOwner: agentTurnContextAuthorityCognitionSource, Rank: 2, TokenEstimate: 60, Included: true}, {StableID: "small", AuthorityOwner: agentTurnContextAuthorityCognitionSource, Rank: 1, TokenEstimate: 30, Included: true}}}}
	if used := truncateOptionalCognitionSourceContext(ls, 100); used != 95 || !ls[0].Items[0].Included || ls[0].Items[1].Included || !ls[0].Items[2].Included {
		t.Fatalf("ranked packing used %d: %#v", used, ls[0].Items)
	}
}
