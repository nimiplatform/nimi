package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalAgentSourceSnapshotV2ReferenceVectorsAreStrictAndTransportFree(t *testing.T) {
	for _, name := range []string{"world-character", "persona-character"} {
		name := name
		t.Run(name, func(t *testing.T) {
			verified := verifiedRealmSourceMaterializationVectorV3(t, name)
			sourceBytes, err := localAgentRealmCanonicalSourceBytesV3(localAgentRealmCharacterSourceFromVerifiedV3(verified.Packet.SemanticPayload.CanonicalSource))
			if err != nil {
				t.Fatal(err)
			}
			originalSource, err := sourceMaterializationCanonicalSourceSemanticV3(verified.Packet.SemanticPayload)
			if err != nil {
				t.Fatal(err)
			}
			originalSourceBytes, err := canonicalizeSourceMaterializationRealmV3(originalSource)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(sourceBytes, originalSourceBytes) {
				t.Fatalf("normalized SnapshotV2 source differs from verified source\n got: %s\nwant: %s", sourceBytes, originalSourceBytes)
			}
			localAgentRef := realmSourceMaterializationProductTestLocalAgentRef(name)
			snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, localAgentRef)
			if err != nil {
				t.Fatalf("finalize SnapshotV2: %v", err)
			}
			if snapshot.Semantic.SourceRef.Kind != verified.Packet.SourceRef.Kind ||
				snapshot.Semantic.SourceRef.ID != verified.Packet.SourceRef.ID ||
				snapshot.Semantic.Source.ProfileHashForTest() != verified.Packet.SemanticPayload.CanonicalSource.ProfileHash {
				t.Fatalf("SnapshotV2 source binding differs: %+v", snapshot.Semantic.SourceRef)
			}
			if snapshot.Semantic.OrderedComponentSetHash != verified.Packet.ClosureSetManifest.OrderedComponentSetHash ||
				snapshot.Semantic.ClosureSetManifestHash != verified.Packet.ClosureSetManifestHash {
				t.Fatal("SnapshotV2 omitted verified closure hashes")
			}
			encoded, err := encodeLocalAgentSourceSnapshotV2(snapshot)
			if err != nil {
				t.Fatalf("encode SnapshotV2: %v", err)
			}
			for _, forbidden := range [][]byte{
				[]byte(`"packetProof"`), []byte(`"compactJws"`), []byte(`"challengeId"`),
				[]byte(`"nonce"`), []byte(`"intendedRuntimeAudience"`), []byte(`"expiresAt"`),
				[]byte(`"orderedSegments"`), []byte(`"segmentManifest"`), []byte(`"canonicalBytes"`),
				[]byte(`"chunks"`), []byte(`"authorizationDecisionDigest"`), []byte(`"accessGrantId"`),
			} {
				if bytes.Contains(encoded, forbidden) {
					t.Fatalf("SnapshotV2 contains forbidden transport field %s", forbidden)
				}
			}
			decoded, err := decodeLocalAgentSourceSnapshotV2(encoded)
			if err != nil {
				t.Fatalf("strict SnapshotV2 roundtrip: %v", err)
			}
			if decoded.SnapshotHash != snapshot.SnapshotHash || decoded.LocalAgentRef != localAgentRef {
				t.Fatal("SnapshotV2 strict roundtrip changed identity or hash")
			}
			projection := localAgentSourceContextStatusV2(snapshot)
			for _, section := range []runtimev1.AgentLocalSourceCoverageSection{
				runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_IDENTITY,
				runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PSYCHOLOGY,
				runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_KNOWLEDGE,
				runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_RELATIONSHIPS,
				runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_WORLD_CORE,
			} {
				if realmSourceProductCoverageStateV2(projection, section) != runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_COMPLETE {
					t.Fatalf("coverage section %s is not complete", section)
				}
			}
			key, err := localAgentRealmSourceProvenanceKeyV3(snapshot)
			if err != nil || !isLowerSHA256V3(key) {
				t.Fatalf("provenance key = %q err=%v", key, err)
			}
			canonicalRef, err := canonicalizeSourceMaterializationRealmV3(snapshot.Semantic.SourceRef)
			if err != nil {
				t.Fatal(err)
			}
			expectedProvenanceInput := append([]byte(localAgentRealmSourceProvenanceHashDomainV3), canonicalRef...)
			expectedProvenanceInput = append(expectedProvenanceInput, snapshot.Semantic.MaterializationContextHash...)
			if key != sha256HexBytes(expectedProvenanceInput) {
				t.Fatal("provenance key does not implement the canonical v3 formula")
			}
		})
	}
}

func TestLocalAgentSourceSnapshotV2HashExcludesRuntimeAndSafePacketProvenance(t *testing.T) {
	verified := verifiedRealmSourceMaterializationVectorV3(t, "world-character")
	first, err := finalizeLocalAgentSourceSnapshotV2(verified, realmSourceMaterializationProductTestLocalAgentRef("hash-first"))
	if err != nil {
		t.Fatal(err)
	}
	second := first
	second.LocalAgentRef = realmSourceMaterializationProductTestLocalAgentRef("hash-second")
	second.CapturedAt = verified.VerifiedAt.Add(time.Second).Format(time.RFC3339Nano)
	second.PacketID = "packet-distinct-safe-provenance"
	second.PacketHash = sha256HexBytes([]byte("distinct verified packet provenance"))
	if first.SnapshotHash != second.SnapshotHash {
		t.Fatalf("equivalent semantics produced different hashes: %s != %s", first.SnapshotHash, second.SnapshotHash)
	}
	if first.LocalAgentRef == second.LocalAgentRef || first.PacketID == second.PacketID || first.CapturedAt == second.CapturedAt {
		t.Fatal("test did not vary excluded identity/provenance fields")
	}
	firstKey, err := localAgentRealmSourceProvenanceKeyV3(first)
	if err != nil {
		t.Fatal(err)
	}
	secondKey, err := localAgentRealmSourceProvenanceKeyV3(second)
	if err != nil {
		t.Fatal(err)
	}
	if firstKey != secondKey {
		t.Fatal("equivalent source/context produced different provenance keys")
	}
	if err := validateLocalAgentSourceSnapshotV2(second); err != nil {
		t.Fatalf("safe packet provenance unexpectedly changed semantic hash validity: %v", err)
	}
}

func TestLocalAgentSourceSnapshotV2CodecRejectsUnknownNonCanonicalAndTamperedState(t *testing.T) {
	verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, realmSourceMaterializationProductTestLocalAgentRef("codec"))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := encodeLocalAgentSourceSnapshotV2(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatal(err)
	}
	object["rawPacket"] = json.RawMessage(`{}`)
	withUnknown, err := json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeLocalAgentSourceSnapshotV2(withUnknown); err == nil {
		t.Fatal("SnapshotV2 codec admitted an unknown rawPacket field")
	}
	var indented bytes.Buffer
	if err := json.Indent(&indented, encoded, "", "  "); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeLocalAgentSourceSnapshotV2(indented.Bytes()); err == nil {
		t.Fatal("SnapshotV2 codec admitted non-canonical JSON")
	}
	tampered := snapshot
	tampered.Semantic.SourceHash = verified.Packet.SemanticPayload.MaterializationContext.OwningWorld.ContentHash
	if _, err := encodeLocalAgentSourceSnapshotV2(tampered); err == nil {
		t.Fatal("SnapshotV2 codec admitted tampered semantic binding")
	}
}

func TestPrepareRealmSourceMaterializationProductV3RollsBackWithoutPartialMutation(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	verified := verifiedRealmSourceMaterializationVectorV3(t, "world-character")
	localAgentRef := realmSourceMaterializationProductTestLocalAgentRef("rollback")
	prepared, projection, err := svc.prepareRealmSourceMaterializationProductV3(
		context.Background(), verified.Packet.MaterializerAccountID, localAgentRef, verified,
	)
	if err != nil {
		t.Fatalf("prepare Realm source product: %v", err)
	}
	if projection.GetLocalAgentRef() != localAgentRef || projection.GetSourceRef().GetWorldCharacter() == nil ||
		projection.GetSnapshotSchemaVersion() != 2 || !projection.GetReady() {
		t.Fatalf("bounded source projection is invalid: %+v", projection)
	}
	sentinel := errors.New("injected failure after complete product write")
	err = svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if err := prepared.commitTx(tx); err != nil {
			return err
		}
		return sentinel
	})
	prepared.rolledBack()
	if !errors.Is(err, sentinel) {
		t.Fatalf("transaction error = %v, want injected failure", err)
	}
	assertRealmSourceMaterializationProductRowsV3(t, svc, localAgentRef, 0)
	if entry, err := svc.agentByID(localAgentRef); entry != nil || status.Code(err) != codes.NotFound {
		t.Fatalf("rolled-back LocalAgent remains visible: entry=%+v err=%v", entry, err)
	}
}

func TestPrepareRealmSourceMaterializationProductV3CommitsAtomicallyWithStrictReadback(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
	localAgentRef := realmSourceMaterializationProductTestLocalAgentRef("commit")
	prepared, projection, err := svc.prepareRealmSourceMaterializationProductV3(
		context.Background(), verified.Packet.MaterializerAccountID, localAgentRef, verified,
	)
	if err != nil {
		t.Fatalf("prepare Realm source product: %v", err)
	}
	if err := svc.backend.WriteTx(context.Background(), prepared.commitTx); err != nil {
		prepared.rolledBack()
		t.Fatalf("commit complete Realm source product: %v", err)
	}
	prepared.committed()
	assertRealmSourceMaterializationProductRowsV3(t, svc, localAgentRef, 1)
	entry, err := svc.agentByID(localAgentRef)
	if err != nil || entry.Agent.GetSourceContextStatus().GetSnapshotHash() != projection.GetSnapshotHash() ||
		entry.Agent.GetRuntimeSourceRef() == "" || entry.Agent.GetRuntimeSourceRef() == localAgentRef {
		t.Fatalf("committed LocalAgent projection = %+v err=%v", entry, err)
	}
	if !bytes.HasPrefix([]byte(entry.Agent.GetRuntimeSourceRef()), []byte(localAgentRealmRuntimeSourceRefPrefixV3)) {
		t.Fatalf("runtime source ref = %q, want v3 identity", entry.Agent.GetRuntimeSourceRef())
	}
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		readback, key, err := readLocalAgentSourceSnapshotV2Tx(tx, localAgentRef)
		if err != nil {
			return err
		}
		if readback.SnapshotHash != projection.GetSnapshotHash() || !isLowerSHA256V3(key) {
			return fmt.Errorf("readback snapshot/provenance mismatch")
		}
		return nil
	}); err != nil {
		t.Fatalf("strict committed readback: %v", err)
	}
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_local_agent_source_snapshot_v2 SET captured_at = ? WHERE local_agent_ref = ?`, time.Now().UTC().Format(time.RFC3339Nano), localAgentRef)
		return err
	}); err == nil {
		t.Fatal("immutable SnapshotV2 admitted an UPDATE")
	}
}

func verifiedRealmSourceMaterializationVectorV3(t *testing.T, name string) verifiedSourceMaterializationV3 {
	t.Helper()
	vector := loadSourceMaterializationReferenceVectorV3(t, name)
	verified, err := verifySourceMaterializationPacketV3(
		bytes.NewReader(vector.Packet), bytes.NewReader(vector.CurrentJWKS),
		sourceMaterializationExpectationFromVectorV3(t, vector),
	)
	if err != nil {
		t.Fatalf("verify %s vector: %v", name, err)
	}
	return verified
}

func realmSourceMaterializationProductTestLocalAgentRef(suffix string) string {
	digest := sha256HexBytes([]byte("Realm source product test:" + suffix))
	return runtimeGeneratedLocalAgentRefPrefix + digest[:32]
}

func assertRealmSourceMaterializationProductRowsV3(t *testing.T, svc *Service, localAgentRef string, want int) {
	t.Helper()
	for _, table := range []struct {
		name   string
		column string
	}{
		{"runtime_local_agent", "local_agent_ref"},
		{"runtime_local_agent_state_projection", "local_agent_ref"},
		{"runtime_local_agent_event_log", "local_agent_ref"},
		{"runtime_agent_ai_config", "agent_instance_id"},
		{"runtime_local_agent_source_snapshot_v2", "local_agent_ref"},
		{"runtime_local_agent_source_provenance_v3", "local_agent_ref"},
	} {
		var got int
		query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s = ?", table.name, table.column)
		if err := svc.backend.DB().QueryRow(query, localAgentRef).Scan(&got); err != nil {
			t.Fatalf("count %s: %v", table.name, err)
		}
		if got != want {
			t.Fatalf("%s rows = %d, want %d", table.name, got, want)
		}
	}
}

func realmSourceProductCoverageStateV2(status *runtimev1.LocalAgentSourceContextStatus, section runtimev1.AgentLocalSourceCoverageSection) runtimev1.AgentLocalSourceCoverageState {
	for _, item := range status.GetCoverageSections() {
		if item.GetSection() == section {
			return item.GetState()
		}
	}
	return runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_UNSPECIFIED
}

func TestLocalAgentSourceProfileCoverageSectionV2RejectsLegacyCharacterRoots(t *testing.T) {
	for _, path := range []string{"placement", "biography", "personaStyle", "contentProfile"} {
		if got := localAgentSourceProfileCoverageSectionV2(path); got != runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
			t.Fatalf("legacy CharacterProfile coverage path %q projected as %s", path, got)
		}
	}
	if got := localAgentSourceProfileCoverageSectionV2("narrative.milestones.0"); got != runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BIOGRAPHY {
		t.Fatalf("current narrative coverage projected as %s", got)
	}
}

// ProfileHashForTest keeps tests on the normalized typed profile rather than
// reaching into transport or Raw JSON state.
func (source localAgentRealmCharacterSourceV3) ProfileHashForTest() string {
	profile, _ := source.Profile.interfaceValue().(map[string]any)
	value, _ := profile["profileHash"].(string)
	return value
}
