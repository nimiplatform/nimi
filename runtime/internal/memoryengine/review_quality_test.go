package memoryengine

import (
	"slices"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestNormalizeReviewOutcomesForWave4AppliesDimensionThresholds(t *testing.T) {
	t.Parallel()

	outcomes := NormalizeReviewOutcomesForWave4(ReviewOutcomes{
		Truths: []TruthRecord{
			{
				TruthID:         "rel-candidate",
				Dimension:       "relational",
				NormalizedKey:   "rel:candidate",
				Statement:       "Relationship signal is promising.",
				Confidence:      0.9,
				Status:          "admitted",
				SourceMemoryIDs: []string{"m1", "m2"},
			},
			{
				TruthID:         "rel-drop",
				Dimension:       "relational",
				NormalizedKey:   "rel:drop",
				Statement:       "Not enough evidence yet.",
				Confidence:      0.95,
				Status:          "admitted",
				SourceMemoryIDs: []string{"m3"},
			},
			{
				TruthID:         "proc-low-confidence",
				Dimension:       "procedural",
				NormalizedKey:   "proc:candidate",
				Statement:       "Likely procedural habit.",
				Confidence:      0.69,
				Status:          "admitted",
				SourceMemoryIDs: []string{"m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11"},
			},
			{
				TruthID:         "proc-admitted",
				Dimension:       "procedural",
				NormalizedKey:   "proc:admitted",
				Statement:       "Stable procedural habit.",
				Confidence:      0.9,
				Status:          "admitted",
				SourceMemoryIDs: []string{"m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19"},
			},
		},
	})

	if len(outcomes.Truths) != 3 {
		t.Fatalf("expected 3 truths after normalization, got %#v", outcomes.Truths)
	}
	byID := make(map[string]TruthRecord, len(outcomes.Truths))
	for _, truth := range outcomes.Truths {
		byID[truth.TruthID] = truth
	}
	if _, ok := byID["rel-drop"]; ok {
		t.Fatalf("expected rel-drop to be discarded, got %#v", byID["rel-drop"])
	}
	if got := byID["rel-candidate"]; got.Status != "candidate" || got.SourceCount != 2 {
		t.Fatalf("expected relational truth to downgrade to candidate with source count 2, got %#v", got)
	}
	if got := byID["proc-low-confidence"]; got.Status != "candidate" || got.SourceCount != 8 {
		t.Fatalf("expected low-confidence procedural truth to stay candidate, got %#v", got)
	}
	if got := byID["proc-admitted"]; got.Status != "admitted" || got.SourceCount != 8 {
		t.Fatalf("expected high-confidence procedural truth to remain admitted, got %#v", got)
	}
}

func TestClusterReviewRecordsIsDeterministicAndDefersSingletons(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	records := []*runtimev1.MemoryRecord{
		testReviewRecord("mem-001", "memory redesign review quality", now.Add(5*time.Minute)),
		testReviewRecord("mem-002", "review quality memory redesign", now.Add(4*time.Minute)),
		testReviewRecord("mem-003", "green tea preference", now.Add(3*time.Minute)),
		testReviewRecord("mem-004", "preference for green tea", now.Add(2*time.Minute)),
		testReviewRecord("mem-005", "astronomy telescope note", now.Add(1*time.Minute)),
	}
	embeddings := map[string][]float64{
		"mem-001": {1, 0},
		"mem-002": {0.98, 0.02},
		"mem-003": {0, 1},
		"mem-004": {0.02, 0.98},
		"mem-005": {0.5, 0.5},
	}

	firstClusters, firstLeftovers := ClusterReviewRecords(records, embeddings)
	secondClusters, secondLeftovers := ClusterReviewRecords(records, embeddings)

	if len(firstClusters) != 2 {
		t.Fatalf("expected 2 clusters, got %#v", firstClusters)
	}
	if got := clusterIDs(firstClusters); !slices.Equal(got, clusterIDs(secondClusters)) {
		t.Fatalf("expected deterministic cluster ids, first=%v second=%v", got, clusterIDs(secondClusters))
	}
	if got := clusterSizes(firstClusters); !slices.Equal(got, []int{2, 2}) {
		t.Fatalf("expected two 2-record clusters, got %#v", got)
	}
	if got := recordIDs(firstLeftovers); !slices.Equal(got, []string{"mem-005"}) {
		t.Fatalf("expected singleton leftover mem-005, got %#v", got)
	}
	if got := recordIDs(secondLeftovers); !slices.Equal(got, []string{"mem-005"}) {
		t.Fatalf("expected deterministic singleton leftovers, got %#v", got)
	}
}

func testReviewRecord(memoryID string, observation string, ts time.Time) *runtimev1.MemoryRecord {
	return &runtimev1.MemoryRecord{
		MemoryId: memoryID,
		Payload: &runtimev1.MemoryRecord_Observational{
			Observational: &runtimev1.ObservationalMemoryRecord{
				Observation: observation,
				ObservedAt:  timestamppb.New(ts),
			},
		},
		CreatedAt: timestamppb.New(ts),
		UpdatedAt: timestamppb.New(ts),
	}
}

func clusterIDs(input []ReviewTopicCluster) []string {
	out := make([]string, 0, len(input))
	for _, cluster := range input {
		out = append(out, stringsJoin(cluster.RecordIDs))
	}
	return out
}

func clusterSizes(input []ReviewTopicCluster) []int {
	out := make([]int, 0, len(input))
	for _, cluster := range input {
		out = append(out, len(cluster.RecordIDs))
	}
	return out
}

func recordIDs(input []*runtimev1.MemoryRecord) []string {
	out := make([]string, 0, len(input))
	for _, record := range input {
		out = append(out, record.GetMemoryId())
	}
	return out
}

func stringsJoin(input []string) string {
	if len(input) == 0 {
		return ""
	}
	value := input[0]
	for idx := 1; idx < len(input); idx++ {
		value += "|" + input[idx]
	}
	return value
}
