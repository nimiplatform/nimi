package runtimepersistence

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/realmsourcecontract"
)

type realmSourceMaterializationRuntimeAgentRefs struct {
	legacy    []string
	currentV3 []string
}

type realmSourceMaterializationQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func collectRealmSourceMaterializationRuntimeAgentRefs(queryer realmSourceMaterializationQueryer) (realmSourceMaterializationRuntimeAgentRefs, error) {
	result := realmSourceMaterializationRuntimeAgentRefs{}
	exists, err := realmSourceMaterializationSchemaObjectExists(queryer, "runtime_local_agent")
	if err != nil || !exists {
		return result, err
	}
	rows, err := queryer.Query(`SELECT local_agent_ref, agent_json FROM runtime_local_agent ORDER BY local_agent_ref`)
	if err != nil {
		return result, fmt.Errorf("inventory Runtime source LocalAgents: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var localAgentRef string
		var agentJSON string
		if err := rows.Scan(&localAgentRef, &agentJSON); err != nil {
			return result, fmt.Errorf("scan Runtime source LocalAgent: %w", err)
		}
		var identity struct {
			RuntimeSourceRef       string `json:"runtimeSourceRef"`
			LegacyRuntimeSourceRef string `json:"runtime_source_ref"`
		}
		if err := json.Unmarshal([]byte(agentJSON), &identity); err != nil {
			return result, fmt.Errorf("decode Runtime LocalAgent %q identity during source inventory: %w", localAgentRef, err)
		}
		runtimeSourceRef := strings.TrimSpace(identity.RuntimeSourceRef)
		legacyRuntimeSourceRef := strings.TrimSpace(identity.LegacyRuntimeSourceRef)
		if runtimeSourceRef != "" && legacyRuntimeSourceRef != "" && runtimeSourceRef != legacyRuntimeSourceRef {
			return result, fmt.Errorf("Runtime LocalAgent %q has conflicting runtimeSourceRef encodings", localAgentRef)
		}
		if runtimeSourceRef == "" {
			runtimeSourceRef = legacyRuntimeSourceRef
		}
		if !strings.HasPrefix(runtimeSourceRef, realmsourcecontract.RuntimeSourceRefPrefix) {
			continue
		}
		localAgentRef = strings.TrimSpace(localAgentRef)
		if localAgentRef == "" {
			return result, fmt.Errorf("Runtime source LocalAgent has an empty local_agent_ref")
		}
		if strings.HasPrefix(runtimeSourceRef, realmsourcecontract.RuntimeSourceRefV3Prefix) {
			result.currentV3 = append(result.currentV3, localAgentRef)
			continue
		}
		result.legacy = append(result.legacy, localAgentRef)
	}
	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("inventory Runtime source LocalAgents: %w", err)
	}
	return result, nil
}

func collectPreV3RealmSourceSnapshotRefs(queryer realmSourceMaterializationQueryer) ([]string, error) {
	exists, err := realmSourceMaterializationSchemaObjectExists(queryer, "runtime_local_agent_source_snapshot_v2")
	if err != nil || !exists {
		return nil, err
	}
	rows, err := queryer.Query(`SELECT local_agent_ref, snapshot_schema_version, normalization_version, compiler_compatibility_version
		FROM runtime_local_agent_source_snapshot_v2 ORDER BY local_agent_ref`)
	if err != nil {
		return nil, fmt.Errorf("inventory Realm source snapshot compatibility: %w", err)
	}
	defer func() { _ = rows.Close() }()
	refs := make([]string, 0)
	for rows.Next() {
		var localAgentRef string
		var snapshotSchemaVersion int64
		var normalizationVersion string
		var compilerCompatibilityVersion string
		if err := rows.Scan(&localAgentRef, &snapshotSchemaVersion, &normalizationVersion, &compilerCompatibilityVersion); err != nil {
			return nil, fmt.Errorf("scan Realm source snapshot compatibility: %w", err)
		}
		if snapshotSchemaVersion == 3 && normalizationVersion == realmsourcecontract.NormalizationVersion &&
			compilerCompatibilityVersion == realmsourcecontract.CompilerCompatibilityVersion {
			continue
		}
		localAgentRef = strings.TrimSpace(localAgentRef)
		if localAgentRef == "" {
			return nil, fmt.Errorf("pre-v3 Realm source snapshot has an empty local_agent_ref")
		}
		refs = append(refs, localAgentRef)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inventory Realm source snapshot compatibility: %w", err)
	}
	return refs, nil
}

func realmSourceMaterializationSchemaObjectExists(queryer realmSourceMaterializationQueryer, name string) (bool, error) {
	var count int
	if err := queryer.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name = ?`, name).Scan(&count); err != nil {
		return false, fmt.Errorf("inspect Realm source schema object %s: %w", name, err)
	}
	return count > 0, nil
}
