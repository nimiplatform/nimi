package runtimeagent

import (
	"bytes"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type preparedRealmSourceMaterializationProductV3 struct {
	svc              *Service
	localAgentRef    string
	previousEntry    *agentEntry
	hadEntry         bool
	previousEvents   []*runtimev1.AgentEvent
	previousSequence uint64
	persisted        persistedRuntimeAgentState
	committedEvents  []*runtimev1.AgentEvent
	seedAIConfig     *runtimev1.RuntimeAgentAIConfig
	snapshot         localAgentSourceSnapshotV2
	commitMu         sync.Mutex
	commitAttempted  bool
	finalizeOnce     sync.Once
}

func (p *preparedRealmSourceMaterializationProductV3) commitTx(tx *sql.Tx) error {
	if p == nil || p.svc == nil || p.svc.stateRepo == nil || p.svc.agentAIConfigRepo == nil || tx == nil {
		return fmt.Errorf("prepared Realm source materialization product is unavailable")
	}
	p.commitMu.Lock()
	if p.commitAttempted {
		p.commitMu.Unlock()
		return fmt.Errorf("prepared Realm source materialization product transaction was already attempted")
	}
	p.commitAttempted = true
	p.commitMu.Unlock()
	if err := p.svc.stateRepo.persistSnapshotTx(tx, p.persisted, nil); err != nil {
		return err
	}
	if err := p.svc.agentAIConfigRepo.commitSeedTx(tx, p.seedAIConfig); err != nil {
		return err
	}
	if err := persistLocalAgentSourceSnapshotV2Tx(tx, p.snapshot); err != nil {
		return err
	}
	return nil
}

func (p *preparedRealmSourceMaterializationProductV3) committed() {
	if p == nil || p.svc == nil {
		return
	}
	p.finalizeOnce.Do(func() {
		targets := p.svc.eventStreamRuntime().matchingSubscribersLocked(p.committedEvents)
		p.svc.mu.Unlock()
		p.svc.eventStreamRuntime().broadcast(p.committedEvents, targets)
		p.svc.recordRuntimeAgentAIConfigAudit(p.seedAIConfig, runtimeAgentAIConfigSeededEventType)
		if err := p.svc.refreshRuntimeAgentAIConfigReadiness(p.localAgentRef); err != nil && p.svc.logger != nil {
			p.svc.logger.Warn("recompute runtime agent ai config readiness after Realm source materialization failed", "local_agent_ref", p.localAgentRef, "error", err)
		}
	})
}

func (p *preparedRealmSourceMaterializationProductV3) rolledBack() {
	if p == nil || p.svc == nil {
		return
	}
	p.finalizeOnce.Do(func() {
		if p.hadEntry {
			p.svc.agents[p.localAgentRef] = p.previousEntry
		} else {
			delete(p.svc.agents, p.localAgentRef)
		}
		p.svc.events = p.previousEvents
		p.svc.sequence = p.previousSequence
		p.svc.mu.Unlock()
	})
}

func persistLocalAgentSourceSnapshotV2Tx(tx *sql.Tx, snapshot localAgentSourceSnapshotV2) error {
	if tx == nil {
		return fmt.Errorf("LocalAgent source snapshot transaction is required")
	}
	typed, err := encodeLocalAgentSourceSnapshotV2(snapshot)
	if err != nil {
		return err
	}
	provenanceKey, err := localAgentRealmSourceProvenanceKeyV3(snapshot)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_source_snapshot_v2(
			local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, realm_issuer, signing_key_fingerprint,
			source_kind, source_id, world_id, source_hash, world_content_hash,
			coverage_hash, materialization_context_hash, payload_hash,
			ordered_component_set_hash, closure_set_manifest_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		) VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, snapshot.LocalAgentRef, snapshot.SnapshotHash, snapshot.CapturedAt,
		snapshot.PacketID, snapshot.PacketHash, snapshot.RealmIssuer, snapshot.SigningKeyFingerprint,
		snapshot.Semantic.SourceRef.Kind, snapshot.Semantic.SourceRef.ID, snapshot.Semantic.SourceRef.WorldID,
		snapshot.Semantic.SourceHash, snapshot.Semantic.WorldContentHash, snapshot.Semantic.CoverageHash,
		snapshot.Semantic.MaterializationContextHash, snapshot.Semantic.PayloadHash,
		snapshot.Semantic.OrderedComponentSetHash, snapshot.Semantic.ClosureSetManifestHash,
		snapshot.NormalizationVersion, snapshot.CompilerCompatibilityVersion, typed); err != nil {
		return fmt.Errorf("insert LocalAgent source snapshot v2: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_source_provenance_v3(
			provenance_key, local_agent_ref, snapshot_hash, materialization_context_hash
		) VALUES (?, ?, ?, ?)
	`, provenanceKey, snapshot.LocalAgentRef, snapshot.SnapshotHash, snapshot.Semantic.MaterializationContextHash); err != nil {
		return fmt.Errorf("insert Realm source provenance v3: %w", err)
	}
	readback, readbackKey, err := readLocalAgentSourceSnapshotV2Tx(tx, snapshot.LocalAgentRef)
	if err != nil {
		return err
	}
	readbackBytes, err := encodeLocalAgentSourceSnapshotV2(readback)
	if err != nil {
		return err
	}
	if readbackKey != provenanceKey || !bytes.Equal(readbackBytes, typed) {
		return fmt.Errorf("LocalAgent source snapshot v2 strict readback mismatch")
	}
	return nil
}

func readLocalAgentSourceSnapshotV2Tx(tx *sql.Tx, localAgentRef string) (localAgentSourceSnapshotV2, string, error) {
	var (
		rowLocalAgentRef, snapshotHash, capturedAt, packetID, packetHash string
		realmIssuer, signingKeyFingerprint                               string
		sourceKind, sourceID, worldID, sourceHash                        string
		worldContentHash, coverageHash, materializationContextHash       string
		payloadHash, orderedComponentSetHash, closureSetManifestHash     string
		normalizationVersion, compilerCompatibilityVersion               string
		typed                                                            []byte
		schemaVersion                                                    int
	)
	err := tx.QueryRow(`
		SELECT local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, realm_issuer, signing_key_fingerprint,
			source_kind, source_id, world_id, source_hash, world_content_hash,
			coverage_hash, materialization_context_hash, payload_hash,
			ordered_component_set_hash, closure_set_manifest_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = ?
	`, strings.TrimSpace(localAgentRef)).Scan(
		&rowLocalAgentRef, &schemaVersion, &snapshotHash, &capturedAt,
		&packetID, &packetHash, &realmIssuer, &signingKeyFingerprint,
		&sourceKind, &sourceID, &worldID, &sourceHash, &worldContentHash,
		&coverageHash, &materializationContextHash, &payloadHash,
		&orderedComponentSetHash, &closureSetManifestHash,
		&normalizationVersion, &compilerCompatibilityVersion, &typed,
	)
	if err != nil {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("read LocalAgent source snapshot v2: %w", err)
	}
	snapshot, err := decodeLocalAgentSourceSnapshotV2(typed)
	if err != nil {
		return localAgentSourceSnapshotV2{}, "", err
	}
	if schemaVersion != 2 || rowLocalAgentRef != snapshot.LocalAgentRef || snapshotHash != snapshot.SnapshotHash ||
		capturedAt != snapshot.CapturedAt || packetID != snapshot.PacketID || packetHash != snapshot.PacketHash ||
		realmIssuer != snapshot.RealmIssuer || signingKeyFingerprint != snapshot.SigningKeyFingerprint ||
		sourceKind != snapshot.Semantic.SourceRef.Kind || sourceID != snapshot.Semantic.SourceRef.ID ||
		worldID != snapshot.Semantic.SourceRef.WorldID || sourceHash != snapshot.Semantic.SourceHash ||
		worldContentHash != snapshot.Semantic.WorldContentHash || coverageHash != snapshot.Semantic.CoverageHash ||
		materializationContextHash != snapshot.Semantic.MaterializationContextHash || payloadHash != snapshot.Semantic.PayloadHash ||
		orderedComponentSetHash != snapshot.Semantic.OrderedComponentSetHash || closureSetManifestHash != snapshot.Semantic.ClosureSetManifestHash ||
		normalizationVersion != snapshot.NormalizationVersion || compilerCompatibilityVersion != snapshot.CompilerCompatibilityVersion {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("LocalAgent source snapshot v2 column binding mismatch")
	}
	var provenanceKey, provenanceSnapshotHash, provenanceContextHash string
	if err := tx.QueryRow(`
		SELECT provenance_key, snapshot_hash, materialization_context_hash
		FROM runtime_local_agent_source_provenance_v3 WHERE local_agent_ref = ?
	`, rowLocalAgentRef).Scan(&provenanceKey, &provenanceSnapshotHash, &provenanceContextHash); err != nil {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("read Realm source provenance v3: %w", err)
	}
	expectedProvenanceKey, err := localAgentRealmSourceProvenanceKeyV3(snapshot)
	if err != nil {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("derive Realm source provenance v3 key: %w", err)
	}
	if provenanceKey != expectedProvenanceKey || provenanceSnapshotHash != snapshot.SnapshotHash ||
		provenanceContextHash != snapshot.Semantic.MaterializationContextHash {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("Realm source provenance v3 binding mismatch")
	}
	return snapshot, provenanceKey, nil
}

func localAgentSourceContextStatusV2(snapshot localAgentSourceSnapshotV2) *runtimev1.LocalAgentSourceContextStatus {
	capturedAt, _ := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	return &runtimev1.LocalAgentSourceContextStatus{
		SchemaVersion: runtimev1.AgentLocalSourceContextSchemaVersion_AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V2,
		Ready:         true, State: runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY,
		ReasonCode:    runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		LocalAgentRef: snapshot.LocalAgentRef, SourceRef: sourceMaterializationProtoRefV3(snapshot.Semantic.SourceRef),
		SourceSchemaVersion:   snapshot.Semantic.Source.SchemaVersion,
		SnapshotSchemaVersion: runtimev1.AgentLocalSourceSnapshotSchemaVersion_AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V2,
		SnapshotHash:          snapshot.SnapshotHash, CapturedAt: timestamppb.New(capturedAt),
		WorldContentHash:           snapshot.Semantic.WorldContentHash,
		MaterializationContextHash: snapshot.Semantic.MaterializationContextHash,
		CoverageSections:           localAgentSourceCoverageProjectionV2(snapshot),
	}
}

func localAgentSourceCoverageProjectionV2(snapshot localAgentSourceSnapshotV2) []*runtimev1.LocalAgentSourceCoverageSectionStatus {
	type counts struct{ required, resolved, omitted uint32 }
	bySection := make(map[runtimev1.AgentLocalSourceCoverageSection]counts)
	profile, _ := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	profileCoverage, _ := profile["profileCoverage"].(map[string]any)
	applyProfileSections := func(raw any, required bool) {
		sections, _ := raw.([]any)
		for _, item := range sections {
			record, _ := item.(map[string]any)
			path, _ := record["path"].(string)
			state, _ := record["state"].(string)
			section := localAgentSourceProfileCoverageSectionV2(path)
			if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
				continue
			}
			value := bySection[section]
			if required {
				value.required++
			}
			if state == "present" {
				value.resolved++
			} else if state == "missing" {
				value.omitted++
			}
			bySection[section] = value
		}
	}
	applyProfileSections(profileCoverage["requiredSections"], true)
	applyProfileSections(profileCoverage["optionalSections"], false)
	applyProfileRefs := func(raw any, required bool) {
		refs, _ := raw.([]any)
		for _, item := range refs {
			record, _ := item.(map[string]any)
			path, _ := record["path"].(string)
			state, _ := record["state"].(string)
			section := localAgentSourceProfileCoverageSectionV2(path)
			if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
				continue
			}
			value := bySection[section]
			if required {
				value.required++
			}
			if state == "resolved" {
				value.resolved++
			} else if state == "missing" {
				value.omitted++
			}
			bySection[section] = value
		}
	}
	applyProfileRefs(profileCoverage["requiredRefs"], true)
	applyProfileRefs(profileCoverage["optionalRefs"], false)
	for _, required := range snapshot.Semantic.Coverage.RequiredSections {
		section := localAgentSourceCoverageSection(required.Path)
		if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
			continue
		}
		value := bySection[section]
		value.required++
		if required.State == "present" {
			value.resolved++
		}
		bySection[section] = value
	}
	closure := bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE]
	for _, required := range snapshot.Semantic.Coverage.RequiredRefs {
		closure.required++
		if required.State == "resolved" {
			closure.resolved++
		}
	}
	for _, optional := range snapshot.Semantic.Coverage.OptionalRefs {
		if optional.State == "omitted" {
			closure.omitted++
		}
	}
	bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE] = closure
	bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_WORLD_CORE] = counts{required: 1, resolved: 1}
	if snapshot.Semantic.SourceRef.Kind == "worldCharacter" {
		bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BOUND_ENTITY] = counts{required: 1, resolved: 1}
	}
	keys := make([]int, 0, len(bySection))
	for section := range bySection {
		keys = append(keys, int(section))
	}
	sort.Ints(keys)
	projection := make([]*runtimev1.LocalAgentSourceCoverageSectionStatus, 0, len(keys))
	for _, key := range keys {
		section := runtimev1.AgentLocalSourceCoverageSection(key)
		value := bySection[section]
		state := runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_COMPLETE
		if value.resolved < value.required {
			state = runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_INVALID
		} else if value.required == 0 && value.omitted > 0 {
			state = runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_OPTIONAL_OMITTED
		}
		projection = append(projection, &runtimev1.LocalAgentSourceCoverageSectionStatus{
			Section: section, State: state, RequiredCount: value.required,
			ResolvedCount: value.resolved, OmittedCount: value.omitted,
		})
	}
	return projection
}

func localAgentSourceProfileCoverageSectionV2(path string) runtimev1.AgentLocalSourceCoverageSection {
	root := strings.TrimSpace(path)
	if index := strings.IndexByte(root, '.'); index >= 0 {
		root = root[:index]
	}
	if root == "narrative" {
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BIOGRAPHY
	}
	return localAgentSourceCoverageSection("source.core." + root)
}

func localAgentRealmSourceDisplayNameV3(snapshot localAgentSourceSnapshotV2) string {
	profile, _ := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	presentation, _ := profile["presentation"].(map[string]any)
	identity, _ := profile["identity"].(map[string]any)
	displayName, _ := presentation["displayName"].(string)
	name, _ := identity["name"].(string)
	return firstNonEmpty(strings.TrimSpace(displayName), strings.TrimSpace(name), snapshot.Semantic.SourceRef.ID, snapshot.LocalAgentRef)
}
