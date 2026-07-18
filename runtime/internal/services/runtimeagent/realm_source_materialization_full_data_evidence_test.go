//go:build realm_v3_full_data

package runtimeagent

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

type realmV3FullDataResidueCountsV1 struct {
	LocalAgents         uint64
	Snapshots           uint64
	Provenance          uint64
	CommittedAttempts   uint64
	ReplayBindings      uint64
	ActiveAttempts      uint64
	RawTransportResidue uint64
	OrphanLocalAgents   uint64
	OrphanSnapshots     uint64
	OrphanProvenance    uint64
}

func inspectRealmV3FullDataAtomicityV1(
	t *testing.T,
	service *Service,
	accountID, requestID, localAgentRef string,
) realmV3FullDataAtomicityEvidenceV1 {
	t.Helper()
	for label, query := range map[string]string{
		"LocalAgent": `SELECT COUNT(*) FROM runtime_local_agent WHERE local_agent_ref = ?`,
		"SnapshotV2": `SELECT COUNT(*) FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = ?`,
		"provenance": `SELECT COUNT(*) FROM runtime_local_agent_source_provenance_v3 WHERE local_agent_ref = ?`,
	} {
		if count := realmV3FullDataQueryCountV1(t, service, query, localAgentRef); count != 1 {
			t.Fatalf("current Realm %s product count=%d, want 1", label, count)
		}
	}
	if count := realmV3FullDataQueryCountV1(t, service, `
		SELECT COUNT(*) FROM runtime_realm_source_materialization_attempt_v3
		WHERE materializer_account_id = ? AND request_id = ? AND state = 'committed' AND local_agent_ref = ?
	`, accountID, requestID, localAgentRef); count != 1 {
		t.Fatalf("current Realm committed attempt count=%d, want 1", count)
	}
	counts := inspectRealmV3FullDataGlobalResidueV1(t, service)
	if counts.ActiveAttempts != 0 || counts.RawTransportResidue != 0 || counts.OrphanLocalAgents != 0 ||
		counts.OrphanSnapshots != 0 || counts.OrphanProvenance != 0 {
		t.Fatalf("current Realm atomic product retained partial/orphan state: %+v", counts)
	}
	return realmV3FullDataAtomicityEvidenceV1{
		LocalAgentsCreated: 1, SnapshotsCreated: 1, ProvenanceCreated: 1,
		PartialProductMutations: 0, RawTransportResidue: 0,
	}
}

func inspectRealmV3FullDataGlobalResidueV1(t *testing.T, service *Service) realmV3FullDataResidueCountsV1 {
	t.Helper()
	counts := realmV3FullDataResidueCountsV1{
		LocalAgents:       realmV3FullDataQueryCountV1(t, service, `SELECT COUNT(*) FROM runtime_local_agent`),
		Snapshots:         realmV3FullDataQueryCountV1(t, service, `SELECT COUNT(*) FROM runtime_local_agent_source_snapshot_v2`),
		Provenance:        realmV3FullDataQueryCountV1(t, service, `SELECT COUNT(*) FROM runtime_local_agent_source_provenance_v3`),
		CommittedAttempts: realmV3FullDataQueryCountV1(t, service, `SELECT COUNT(*) FROM runtime_realm_source_materialization_attempt_v3 WHERE state = 'committed'`),
		ReplayBindings:    realmV3FullDataQueryCountV1(t, service, `SELECT COUNT(*) FROM runtime_realm_source_materialization_replay_v3`),
		ActiveAttempts: realmV3FullDataQueryCountV1(t, service, `
			SELECT COUNT(*) FROM runtime_realm_source_materialization_attempt_v3
			WHERE state IN ('requested','acquiring','verifying','committing')
		`),
		OrphanLocalAgents: realmV3FullDataQueryCountV1(t, service, `
			SELECT COUNT(*) FROM runtime_local_agent AS agent
			LEFT JOIN runtime_local_agent_source_snapshot_v2 AS snapshot ON snapshot.local_agent_ref = agent.local_agent_ref
			LEFT JOIN runtime_local_agent_source_provenance_v3 AS provenance ON provenance.local_agent_ref = agent.local_agent_ref
			WHERE snapshot.local_agent_ref IS NULL OR provenance.local_agent_ref IS NULL
		`),
		OrphanSnapshots: realmV3FullDataQueryCountV1(t, service, `
			SELECT COUNT(*) FROM runtime_local_agent_source_snapshot_v2 AS snapshot
			LEFT JOIN runtime_local_agent AS agent ON agent.local_agent_ref = snapshot.local_agent_ref
			WHERE agent.local_agent_ref IS NULL
		`),
		OrphanProvenance: realmV3FullDataQueryCountV1(t, service, `
			SELECT COUNT(*) FROM runtime_local_agent_source_provenance_v3 AS provenance
			LEFT JOIN runtime_local_agent AS agent ON agent.local_agent_ref = provenance.local_agent_ref
			LEFT JOIN runtime_local_agent_source_snapshot_v2 AS snapshot ON snapshot.local_agent_ref = provenance.local_agent_ref
			WHERE agent.local_agent_ref IS NULL OR snapshot.local_agent_ref IS NULL
		`),
	}
	if service.realmSourceMaterializationStagingV3 == nil {
		t.Fatal("full-data Runtime staging owner is unavailable")
	}
	entries, err := os.ReadDir(service.realmSourceMaterializationStagingV3.root)
	if err != nil {
		t.Fatalf("inventory full-data raw transport staging: %v", err)
	}
	counts.RawTransportResidue = uint64(len(entries))
	return counts
}

func realmV3FullDataQueryCountV1(t *testing.T, service *Service, query string, args ...any) uint64 {
	t.Helper()
	var count uint64
	if err := service.backend.DB().QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatalf("query full-data Runtime product count: %v", err)
	}
	return count
}

func realmV3FullDataCommittedLocalAgentRefV1(
	t *testing.T,
	service *Service,
	accountID, requestID string,
) string {
	t.Helper()
	rows, err := service.backend.DB().Query(`
		SELECT local_agent_ref FROM runtime_realm_source_materialization_attempt_v3
		WHERE materializer_account_id = ? AND request_id = ? AND state = 'committed'
	`, accountID, requestID)
	if err != nil {
		t.Fatalf("query committed full-data LocalAgent: %v", err)
	}
	defer rows.Close()
	refs := make([]string, 0, 1)
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			t.Fatalf("scan committed full-data LocalAgent: %v", err)
		}
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate committed full-data LocalAgent: %v", err)
	}
	if len(refs) != 1 || strings.TrimSpace(refs[0]) == "" {
		t.Fatalf("committed full-data LocalAgent cardinality=%d, want 1", len(refs))
	}
	return refs[0]
}

func isRealmV3FullDataGitObjectV1(value string) bool {
	if len(value) != 40 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func inflateRealmV3FullDataPacketV1(t *testing.T, request realmV3FullDataPartitionRequestV1) string {
	t.Helper()
	compressed, err := os.ReadFile(request.Capture.PacketPath)
	if err != nil {
		t.Fatalf("read captured Packet v3: %v", err)
	}
	if int64(len(compressed)) != request.Capture.PacketBytes {
		t.Fatalf("captured Packet v3 bytes = %d, want %d", len(compressed), request.Capture.PacketBytes)
	}
	digest := sha256.Sum256(compressed)
	if hex.EncodeToString(digest[:]) != request.Capture.PacketSHA256 {
		t.Fatal("captured Packet v3 digest mismatch")
	}
	gzipReader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatalf("open captured Packet v3 gzip: %v", err)
	}
	wireBudget, err := sourceMaterializationWireBudgetV3(request.Capture.Expectation.PublishedLimits)
	if err != nil {
		gzipReader.Close()
		t.Fatalf("derive captured Packet v3 wire budget: %v", err)
	}
	temporary, err := os.CreateTemp("", "nimi-realm-v3-full-packet-*.json")
	if err != nil {
		gzipReader.Close()
		t.Fatalf("create private Packet v3 staging: %v", err)
	}
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		gzipReader.Close()
		os.Remove(temporary.Name())
		t.Fatalf("restrict private Packet v3 staging: %v", err)
	}
	limited := &io.LimitedReader{R: gzipReader, N: wireBudget + 1}
	written, copyErr := io.Copy(temporary, limited)
	closeErr := temporary.Close()
	gzipCloseErr := gzipReader.Close()
	if copyErr != nil || closeErr != nil || gzipCloseErr != nil || written > wireBudget {
		os.Remove(temporary.Name())
		t.Fatalf("inflate bounded captured Packet v3: copied=%d copy=%v close=%v gzip=%v", written, copyErr, closeErr, gzipCloseErr)
	}
	return temporary.Name()
}

func assertRealmV3FullDataTransportV1(t *testing.T, verified verifiedSourceMaterializationV3, want realmV3FullDataExpectedTransportV1) {
	t.Helper()
	manifest := verified.Packet.ClosureSetManifest
	var canonicalBytes uint64
	for _, segment := range manifest.Segments {
		canonicalBytes += segment.TotalCanonicalBytes
	}
	got := realmV3FullDataExpectedTransportV1{
		PacketHash:                 verified.Packet.PacketHash,
		ClosureSetManifestHash:     verified.Packet.ClosureSetManifestHash,
		OrderedComponentSetHash:    manifest.OrderedComponentSetHash,
		MaterializationContextHash: verified.Packet.MaterializationContextHash,
		PayloadHash:                verified.Packet.PayloadHash,
		SegmentCount:               manifest.SegmentCount,
		ComponentCount:             manifest.ComponentCount,
		ChunkCount:                 manifest.ChunkCount,
		CanonicalBytes:             canonicalBytes,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("strict Runtime transport result differs from capture index: got=%+v want=%+v", got, want)
	}
}

func compileRealmV3FullDataMaterializationV1(t *testing.T, snapshot localAgentSourceSnapshotV2) realmV3FullDataMaterializationEvidenceV1 {
	t.Helper()
	items, err := compileAgentTurnSourceSnapshotV3(snapshot)
	if err != nil {
		t.Fatalf("compile full-data SnapshotV2 source lanes: %v", err)
	}
	allLanes, err := makeAgentTurnContextLanes(items)
	if err != nil {
		t.Fatalf("order full-data SnapshotV2 source lanes: %v", err)
	}
	sourceLaneIDs := []agentTurnContextLaneID{
		agentTurnContextLaneSourceIdentity,
		agentTurnContextLaneSourceBehavior,
		agentTurnContextLaneWorldContext,
		agentTurnContextLaneRelationshipContext,
		agentTurnContextLaneSourceKnowledge,
	}
	laneByID := make(map[agentTurnContextLaneID]agentTurnContextLane, len(allLanes))
	for _, lane := range allLanes {
		laneByID[lane.LaneID] = lane
	}
	sourceLanes := make([]agentTurnContextLane, 0, len(sourceLaneIDs))
	laneHashes := make(map[string]string, len(sourceLaneIDs))
	laneCounts := make(map[string]uint64, len(sourceLaneIDs))
	for _, laneID := range sourceLaneIDs {
		lane, ok := laneByID[laneID]
		if !ok {
			t.Fatalf("full-data compiler omitted source lane %s", laneID)
		}
		hash, err := hashAgentTurnContextLane(lane)
		if err != nil {
			t.Fatalf("hash full-data source lane %s: %v", laneID, err)
		}
		var included uint64
		for _, item := range lane.Items {
			if item.Included {
				included++
			}
		}
		laneHashes[string(laneID)] = hash
		laneCounts[string(laneID)] = included
		sourceLanes = append(sourceLanes, lane)
	}
	sourceLanesHash, err := hashAgentTurnContextContent(sourceLanes)
	if err != nil {
		t.Fatalf("hash full-data five source lanes: %v", err)
	}
	return realmV3FullDataMaterializationEvidenceV1{
		SnapshotSchema:             realmV3FullDataSnapshotSchemaV2,
		SnapshotHash:               snapshot.SnapshotHash,
		MaterializationContextHash: snapshot.Semantic.MaterializationContextHash,
		SourceLaneSemanticHashes:   laneHashes,
		SourceLaneItemCounts:       laneCounts,
		SourceLanesHash:            sourceLanesHash,
	}
}

func mustRealmV3FullDataInstantV1(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.Location() != time.UTC {
		t.Fatalf("full-data capture instant %q is invalid", value)
	}
	return parsed.UTC()
}

func writeRealmV3FullDataReceiptV1(t *testing.T, receiptPath string, receipt realmV3FullDataPartitionReceiptV1) {
	t.Helper()
	contentHash, err := realmV3FullDataReceiptContentHashV1(receipt)
	if err != nil {
		t.Fatalf("hash full-data partition receipt: %v", err)
	}
	receipt.ContentHash = contentHash
	if err := writeRealmV3FullDataPrivateJSONAtomicV1(receiptPath, receipt); err != nil {
		t.Fatalf("durably commit full-data partition receipt: %v", err)
	}
}

func realmV3FullDataReceiptContentHashV1(receipt realmV3FullDataPartitionReceiptV1) (string, error) {
	receipt.ContentHash = ""
	raw, err := json.Marshal(receipt)
	if err != nil {
		return "", fmt.Errorf("encode receipt content: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil {
		return "", fmt.Errorf("normalize receipt content: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("normalize receipt content trailing JSON")
	}
	delete(document, "contentHash")
	return realmV3FullDataCanonicalDomainHashV1(realmV3FullDataPartitionReceiptSchemaV1, document)
}

func realmV3FullDataCanonicalDomainHashV1(domain string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode canonical domain value: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var normalized any
	if err := decoder.Decode(&normalized); err != nil {
		return "", fmt.Errorf("normalize canonical domain value: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("normalize canonical domain value trailing JSON")
	}
	var canonical bytes.Buffer
	if err := appendRealmV3FullDataCanonicalJSONV1(&canonical, normalized); err != nil {
		return "", err
	}
	domainSeparated := make([]byte, 0, len(domain)+1+canonical.Len())
	domainSeparated = append(domainSeparated, domain...)
	domainSeparated = append(domainSeparated, 0)
	domainSeparated = append(domainSeparated, canonical.Bytes()...)
	return sha256HexBytes(domainSeparated), nil
}

func appendRealmV3FullDataCanonicalJSONV1(target *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil:
		target.WriteString("null")
	case bool:
		if typed {
			target.WriteString("true")
		} else {
			target.WriteString("false")
		}
	case string:
		encoded, err := realmV3FullDataCanonicalJSONStringV1(typed)
		if err != nil {
			return err
		}
		target.Write(encoded)
	case json.Number:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Errorf("encode canonical JSON number: %w", err)
		}
		target.Write(encoded)
	case []any:
		target.WriteByte('[')
		for index, item := range typed {
			if index != 0 {
				target.WriteByte(',')
			}
			if err := appendRealmV3FullDataCanonicalJSONV1(target, item); err != nil {
				return err
			}
		}
		target.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		target.WriteByte('{')
		for index, key := range keys {
			if index != 0 {
				target.WriteByte(',')
			}
			encodedKey, err := realmV3FullDataCanonicalJSONStringV1(key)
			if err != nil {
				return err
			}
			target.Write(encodedKey)
			target.WriteByte(':')
			if err := appendRealmV3FullDataCanonicalJSONV1(target, typed[key]); err != nil {
				return err
			}
		}
		target.WriteByte('}')
	default:
		return fmt.Errorf("canonical JSON contains unsupported %T", value)
	}
	return nil
}

func realmV3FullDataCanonicalJSONStringV1(value string) ([]byte, error) {
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("encode canonical JSON string: %w", err)
	}
	return bytes.TrimSuffix(encoded.Bytes(), []byte{'\n'}), nil
}
