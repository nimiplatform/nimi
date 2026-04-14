package memoryengine

import (
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	wave4TruthAdmissionConfidenceFloor = 0.7
	wave4ClusterMinCosine              = 0.70
	wave4ClusterMinFinalScore          = 0.74
	wave4ClusterMinMembers             = 2
	wave4ClusterMaxMembers             = 12
)

type TruthThresholds struct {
	CandidateFloor int
	AdmissionFloor int
}

type ReviewTopicCluster struct {
	RecordIDs []string
	Records   []*runtimev1.MemoryRecord
}

type reviewTopicClusterState struct {
	recordIDs []string
	records   []*runtimev1.MemoryRecord
	vectorSum []float64
	centroid  []float64
	tokens    map[string]struct{}
}

var wave4TruthThresholdsByDimension = map[string]TruthThresholds{
	"relational": {CandidateFloor: 2, AdmissionFloor: 4},
	"cognitive":  {CandidateFloor: 3, AdmissionFloor: 5},
	"value":      {CandidateFloor: 3, AdmissionFloor: 6},
	"procedural": {CandidateFloor: 4, AdmissionFloor: 8},
}

func Wave4TruthThresholdsForDimension(dimension string) (TruthThresholds, bool) {
	thresholds, ok := wave4TruthThresholdsByDimension[strings.ToLower(strings.TrimSpace(dimension))]
	return thresholds, ok
}

func NormalizeReviewOutcomesForWave4(outcomes ReviewOutcomes) ReviewOutcomes {
	normalized := ReviewOutcomes{
		Narratives: append([]NarrativeRecord(nil), outcomes.Narratives...),
		Relations:  append([]RelationRecord(nil), outcomes.Relations...),
		Summary:    outcomes.Summary,
	}
	if len(outcomes.Truths) == 0 {
		return normalized
	}
	normalized.Truths = make([]TruthRecord, 0, len(outcomes.Truths))
	for _, truth := range outcomes.Truths {
		item, keep := normalizeTruthRecordForWave4(truth)
		if keep {
			normalized.Truths = append(normalized.Truths, item)
		}
	}
	return normalized
}

func ClusterReviewRecords(records []*runtimev1.MemoryRecord, embeddings map[string][]float64) ([]ReviewTopicCluster, []*runtimev1.MemoryRecord) {
	ordered := make([]*runtimev1.MemoryRecord, 0, len(records))
	for _, record := range records {
		if record != nil {
			ordered = append(ordered, record)
		}
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		left := reviewRecordTimestamp(ordered[i])
		right := reviewRecordTimestamp(ordered[j])
		if left.Equal(right) {
			return ordered[i].GetMemoryId() < ordered[j].GetMemoryId()
		}
		return left.After(right)
	})

	clusters := make([]reviewTopicClusterState, 0)
	leftovers := make([]*runtimev1.MemoryRecord, 0)
	for _, record := range ordered {
		memoryID := strings.TrimSpace(record.GetMemoryId())
		vector := embeddings[memoryID]
		if memoryID == "" || len(vector) == 0 {
			leftovers = append(leftovers, record)
			continue
		}
		tokenSet := reviewTokenSet(reviewRecordSearchText(record))
		bestIndex := -1
		bestScore := 0.0
		bestSeed := ""
		for idx := range clusters {
			cluster := clusters[idx]
			if len(cluster.records) >= wave4ClusterMaxMembers {
				continue
			}
			cosine := reviewCosineSimilarity(vector, cluster.centroid)
			if cosine < wave4ClusterMinCosine {
				continue
			}
			lexical := lexicalOverlap(tokenSet, cluster.tokens)
			finalScore := 0.8*cosine + 0.2*lexical
			if finalScore < wave4ClusterMinFinalScore {
				continue
			}
			seed := ""
			if len(cluster.recordIDs) > 0 {
				seed = cluster.recordIDs[0]
			}
			if bestIndex == -1 || finalScore > bestScore || (finalScore == bestScore && seed < bestSeed) {
				bestIndex = idx
				bestScore = finalScore
				bestSeed = seed
			}
		}
		if bestIndex == -1 {
			clusters = append(clusters, newReviewTopicClusterState(record, vector, tokenSet))
			continue
		}
		clusters[bestIndex] = addRecordToReviewTopicCluster(clusters[bestIndex], record, vector, tokenSet)
	}

	outClusters := make([]ReviewTopicCluster, 0, len(clusters))
	for _, cluster := range clusters {
		if len(cluster.records) < wave4ClusterMinMembers {
			leftovers = append(leftovers, cluster.records...)
			continue
		}
		outClusters = append(outClusters, ReviewTopicCluster{
			RecordIDs: append([]string(nil), cluster.recordIDs...),
			Records:   append([]*runtimev1.MemoryRecord(nil), cluster.records...),
		})
	}
	return outClusters, leftovers
}

func normalizeTruthRecordForWave4(input TruthRecord) (TruthRecord, bool) {
	thresholds, ok := Wave4TruthThresholdsForDimension(input.Dimension)
	if !ok {
		return cloneTruthRecord(input), true
	}
	output := cloneTruthRecord(input)
	sourceCount := truthSourceCount(output)
	output.SourceCount = int32(sourceCount)
	if sourceCount < thresholds.CandidateFloor {
		return TruthRecord{}, false
	}
	statusValue := strings.ToLower(strings.TrimSpace(output.Status))
	switch statusValue {
	case "stale", "invalidated":
		return output, true
	}
	if sourceCount < thresholds.AdmissionFloor || output.Confidence < wave4TruthAdmissionConfidenceFloor {
		output.Status = "candidate"
		return output, true
	}
	if statusValue == "" {
		output.Status = "candidate"
	}
	return output, true
}

func cloneTruthRecord(input TruthRecord) TruthRecord {
	output := input
	output.SourceMemoryIDs = append([]string(nil), input.SourceMemoryIDs...)
	return output
}

func truthSourceCount(input TruthRecord) int {
	if input.SourceCount > 0 {
		return int(input.SourceCount)
	}
	if len(input.SourceMemoryIDs) == 0 {
		return 0
	}
	seen := make(map[string]struct{}, len(input.SourceMemoryIDs))
	count := 0
	for _, memoryID := range input.SourceMemoryIDs {
		key := strings.TrimSpace(memoryID)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		count++
	}
	return count
}

func newReviewTopicClusterState(record *runtimev1.MemoryRecord, vector []float64, tokenSet map[string]struct{}) reviewTopicClusterState {
	state := reviewTopicClusterState{
		recordIDs: []string{record.GetMemoryId()},
		records:   []*runtimev1.MemoryRecord{record},
		vectorSum: append([]float64(nil), vector...),
		tokens:    copyTokenSet(tokenSet),
	}
	state.centroid = normalizeVector(state.vectorSum)
	return state
}

func addRecordToReviewTopicCluster(state reviewTopicClusterState, record *runtimev1.MemoryRecord, vector []float64, tokenSet map[string]struct{}) reviewTopicClusterState {
	state.recordIDs = append(state.recordIDs, record.GetMemoryId())
	state.records = append(state.records, record)
	if len(state.vectorSum) == len(vector) {
		for idx := range state.vectorSum {
			state.vectorSum[idx] += vector[idx]
		}
	}
	state.centroid = normalizeVector(state.vectorSum)
	for token := range tokenSet {
		state.tokens[token] = struct{}{}
	}
	return state
}

func reviewRecordSearchText(record *runtimev1.MemoryRecord) string {
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Episodic:
		return strings.TrimSpace(strings.Join([]string{
			payload.Episodic.GetSummary(),
			strings.Join(payload.Episodic.GetParticipants(), " "),
		}, " "))
	case *runtimev1.MemoryRecord_Semantic:
		return strings.TrimSpace(strings.Join([]string{
			payload.Semantic.GetSubject(),
			payload.Semantic.GetPredicate(),
			payload.Semantic.GetObject(),
			"semantic",
		}, " "))
	case *runtimev1.MemoryRecord_Observational:
		return strings.TrimSpace(strings.Join([]string{
			payload.Observational.GetObservation(),
			payload.Observational.GetSourceRef(),
		}, " "))
	default:
		return ""
	}
}

func reviewRecordTimestamp(record *runtimev1.MemoryRecord) time.Time {
	switch payload := record.GetPayload().(type) {
	case *runtimev1.MemoryRecord_Episodic:
		if ts := payload.Episodic.GetOccurredAt(); ts != nil {
			return ts.AsTime()
		}
	case *runtimev1.MemoryRecord_Observational:
		if ts := payload.Observational.GetObservedAt(); ts != nil {
			return ts.AsTime()
		}
	}
	if ts := record.GetProvenance().GetCommittedAt(); ts != nil {
		return ts.AsTime()
	}
	if ts := record.GetCreatedAt(); ts != nil {
		return ts.AsTime()
	}
	return time.Time{}
}

func reviewTokenSet(raw string) map[string]struct{} {
	tokens := strings.Fields(buildReviewSearchTokens(raw))
	if len(tokens) == 0 {
		return map[string]struct{}{}
	}
	out := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		if token == "" {
			continue
		}
		out[token] = struct{}{}
	}
	return out
}

func lexicalOverlap(left map[string]struct{}, right map[string]struct{}) float64 {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	intersection := 0
	for token := range left {
		if _, ok := right[token]; ok {
			intersection++
		}
	}
	if intersection == 0 {
		return 0
	}
	denominator := len(left)
	if len(right) > denominator {
		denominator = len(right)
	}
	return float64(intersection) / float64(denominator)
}

func reviewCosineSimilarity(left []float64, right []float64) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return 0
	}
	var dot float64
	for idx := range left {
		dot += left[idx] * right[idx]
	}
	return dot
}

func normalizeVector(input []float64) []float64 {
	if len(input) == 0 {
		return nil
	}
	var norm float64
	for _, value := range input {
		norm += value * value
	}
	if norm == 0 {
		return append([]float64(nil), input...)
	}
	norm = sqrt(norm)
	out := make([]float64, len(input))
	for idx := range input {
		out[idx] = input[idx] / norm
	}
	return out
}

func copyTokenSet(input map[string]struct{}) map[string]struct{} {
	if len(input) == 0 {
		return map[string]struct{}{}
	}
	out := make(map[string]struct{}, len(input))
	for token := range input {
		out[token] = struct{}{}
	}
	return out
}

func sqrt(input float64) float64 {
	if input <= 0 {
		return 0
	}
	z := input
	for i := 0; i < 8; i++ {
		z -= (z*z - input) / (2 * z)
	}
	return z
}
