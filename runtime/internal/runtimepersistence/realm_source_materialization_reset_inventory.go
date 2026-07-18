package runtimepersistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/realmsourcecontract"
)

func collectRetiredRealmSourceLocalAgentRefsTx(tx *sql.Tx) ([]string, error) {
	seen := map[string]struct{}{}
	for _, table := range []string{retiredSourceSnapshotTable, retiredSourceProvenanceTable} {
		exists, err := resetSchemaObjectExistsTx(tx, table)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		rows, err := tx.Query("SELECT local_agent_ref FROM " + table)
		if err != nil {
			return nil, fmt.Errorf("inventory retired source LocalAgents from %s: %w", table, err)
		}
		for rows.Next() {
			var ref string
			if err := rows.Scan(&ref); err != nil {
				_ = rows.Close()
				return nil, fmt.Errorf("scan retired source LocalAgent from %s: %w", table, err)
			}
			if ref = strings.TrimSpace(ref); ref != "" {
				seen[ref] = struct{}{}
			}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	refs := make([]string, 0, len(seen))
	for ref := range seen {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	return refs, nil
}

func collectRealmSourceMaterializationRuntimeAgentRefs(queryer realmSourceMaterializationQueryer) (realmSourceMaterializationRuntimeAgentRefs, error) {
	result := realmSourceMaterializationRuntimeAgentRefs{}
	exists, err := resetSchemaObjectExists(queryer, "runtime_local_agent")
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
			return result, fmt.Errorf("decode Runtime LocalAgent %q identity during source reset inventory: %w", localAgentRef, err)
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
	exists, err := resetSchemaObjectExists(queryer, "runtime_local_agent_source_snapshot_v2")
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
		if snapshotSchemaVersion == 2 && normalizationVersion == realmsourcecontract.NormalizationVersion &&
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

func collectAgentScopedMemoryBankKeysTx(tx *sql.Tx, refs []string) ([]string, error) {
	exists, err := resetSchemaObjectExistsTx(tx, "memory_bank")
	if err != nil || !exists || len(refs) == 0 {
		return nil, err
	}
	seen := map[string]struct{}{}
	for _, ref := range refs {
		core := "agent-core::" + ref
		dyadic := "agent-dyadic::" + ref + "::"
		rows, err := tx.Query(`SELECT locator_key FROM memory_bank WHERE locator_key = ? OR substr(locator_key, 1, length(?)) = ?`, core, dyadic, dyadic)
		if err != nil {
			return nil, fmt.Errorf("inventory agent-scoped memory for %s: %w", ref, err)
		}
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				_ = rows.Close()
				return nil, err
			}
			seen[key] = struct{}{}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys, nil
}

func collectAffectedPublicChatAnchorIDsTx(tx *sql.Tx, refs []string) ([]string, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil || !exists {
		return nil, err
	}
	var raw string
	err = tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read public chat anchors for Realm source reset inventory: %w", err)
	}
	var state struct {
		Anchors []struct {
			ConversationAnchorID string `json:"conversationAnchorId"`
			AgentID              string `json:"agentId"`
			LocalAgentRef        string `json:"localAgentRef"`
		} `json:"anchors"`
		FollowUps []struct {
			ConversationAnchorID string `json:"conversationAnchorId"`
			AgentID              string `json:"agentId"`
		} `json:"followUps"`
		AvatarLiveInstances []struct {
			ConversationAnchorID string `json:"conversationAnchorId"`
			AgentID              string `json:"agentId"`
			LocalAgentRef        string `json:"localAgentRef"`
		} `json:"avatarLiveInstances"`
	}
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return nil, fmt.Errorf("decode public chat anchors for Realm source reset inventory: %w", err)
	}
	refSet := resetStringSet(refs)
	seen := map[string]struct{}{}
	addAnchorID := func(raw string) error {
		anchorID := strings.TrimSpace(raw)
		if anchorID == "" {
			return fmt.Errorf("affected public chat dependency has an empty conversationAnchorId")
		}
		seen[anchorID] = struct{}{}
		return nil
	}
	for _, anchor := range state.Anchors {
		_, affectedLocalRef := refSet[strings.TrimSpace(anchor.LocalAgentRef)]
		_, affectedAgentID := refSet[strings.TrimSpace(anchor.AgentID)]
		if !affectedLocalRef && !affectedAgentID {
			continue
		}
		if err := addAnchorID(anchor.ConversationAnchorID); err != nil {
			return nil, err
		}
	}
	for _, followUp := range state.FollowUps {
		if _, affected := refSet[strings.TrimSpace(followUp.AgentID)]; !affected {
			continue
		}
		if err := addAnchorID(followUp.ConversationAnchorID); err != nil {
			return nil, err
		}
	}
	for _, avatar := range state.AvatarLiveInstances {
		_, affectedLocalRef := refSet[strings.TrimSpace(avatar.LocalAgentRef)]
		_, affectedAgentID := refSet[strings.TrimSpace(avatar.AgentID)]
		if !affectedLocalRef && !affectedAgentID {
			continue
		}
		if err := addAnchorID(avatar.ConversationAnchorID); err != nil {
			return nil, err
		}
	}
	anchorIDs := make([]string, 0, len(seen))
	for anchorID := range seen {
		anchorIDs = append(anchorIDs, anchorID)
	}
	sort.Strings(anchorIDs)
	return anchorIDs, nil
}

func pruneAffectedPublicChatStateTx(tx *sql.Tx, refs []string, counts map[string]int64) error {
	if len(refs) == 0 {
		return nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil || !exists {
		return err
	}
	var raw string
	err = tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read public chat state for Realm source reset: %w", err)
	}

	var state map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return fmt.Errorf("decode public chat state for Realm source reset: %w", err)
	}
	refSet := resetStringSet(refs)
	removedAnchorIDs := map[string]struct{}{}
	anchors, changed, err := filterResetJSONArray(state["anchors"], func(item map[string]any) bool {
		ref, _ := item["localAgentRef"].(string)
		if _, remove := refSet[strings.TrimSpace(ref)]; !remove {
			return false
		}
		if anchorID, _ := item["conversationAnchorId"].(string); strings.TrimSpace(anchorID) != "" {
			removedAnchorIDs[strings.TrimSpace(anchorID)] = struct{}{}
		}
		return true
	})
	if err != nil {
		return fmt.Errorf("filter public chat anchors for Realm source reset: %w", err)
	}
	state["anchors"] = anchors
	removeStrings := make(map[string]struct{}, len(refSet)+len(removedAnchorIDs))
	for value := range refSet {
		removeStrings[value] = struct{}{}
	}
	for value := range removedAnchorIDs {
		removeStrings[value] = struct{}{}
	}
	for _, key := range []string{"followUps", "avatarLiveInstances"} {
		filtered, collectionChanged, err := filterResetJSONArray(state[key], func(item map[string]any) bool {
			if !resetJSONContainsExactString(item, removeStrings) {
				return false
			}
			if anchorID, _ := item["conversationAnchorId"].(string); strings.TrimSpace(anchorID) != "" {
				anchorID = strings.TrimSpace(anchorID)
				removedAnchorIDs[anchorID] = struct{}{}
				removeStrings[anchorID] = struct{}{}
			}
			return true
		})
		if err != nil {
			return fmt.Errorf("filter public chat %s for Realm source reset: %w", key, err)
		}
		state[key] = filtered
		changed = changed || collectionChanged
	}
	if !changed {
		return nil
	}
	var version uint64
	if err := json.Unmarshal(state["version"], &version); err != nil {
		return fmt.Errorf("decode public chat version for Realm source reset: %w", err)
	}
	if version == ^uint64(0) {
		return fmt.Errorf("public chat version overflow during Realm source reset")
	}
	version++
	state["version"] = json.RawMessage(strconv.FormatUint(version, 10))
	state["savedAt"] = json.RawMessage(strconvQuote(time.Now().UTC().Format(time.RFC3339Nano)))
	updated, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode public chat state for Realm source reset: %w", err)
	}
	result, err := tx.Exec(`UPDATE runtime_local_agent_meta SET value = ? WHERE key = 'public_chat_surface_state'`, string(updated))
	if err != nil {
		return fmt.Errorf("write public chat state for Realm source reset: %w", err)
	}
	counts["publicChatStateRows"], _ = result.RowsAffected()
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_surface_version', ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value
	`, strconv.FormatUint(version, 10)); err != nil {
		return fmt.Errorf("write public chat version for Realm source reset: %w", err)
	}
	for anchorID := range removedAnchorIDs {
		result, err := tx.Exec(`DELETE FROM runtime_local_agent_meta WHERE key = ?`, "public_chat_anchor_metadata:"+anchorID)
		if err != nil {
			return fmt.Errorf("delete public chat anchor metadata for Realm source reset: %w", err)
		}
		deleted, _ := result.RowsAffected()
		counts["publicChatAnchorMetadataRows"] += deleted
	}
	return nil
}

func strconvQuote(value string) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func filterResetJSONArray(raw json.RawMessage, remove func(map[string]any) bool) (json.RawMessage, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("[]"), false, nil
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, false, err
	}
	retained := make([]map[string]any, 0, len(items))
	changed := false
	for _, item := range items {
		if remove(item) {
			changed = true
			continue
		}
		retained = append(retained, item)
	}
	encoded, err := json.Marshal(retained)
	return encoded, changed, err
}

func resetJSONContainsExactString(value any, needles map[string]struct{}) bool {
	switch typed := value.(type) {
	case string:
		_, ok := needles[typed]
		return ok
	case []any:
		for _, item := range typed {
			if resetJSONContainsExactString(item, needles) {
				return true
			}
		}
	case map[string]any:
		for _, item := range typed {
			if resetJSONContainsExactString(item, needles) {
				return true
			}
		}
	}
	return false
}

func resetStringSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			set[value] = struct{}{}
		}
	}
	return set
}

func resetSchemaObjectExists(queryer realmSourceMaterializationQueryer, name string) (bool, error) {
	var count int
	if err := queryer.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name = ?`, name).Scan(&count); err != nil {
		return false, fmt.Errorf("inspect Realm source reset schema object %s: %w", name, err)
	}
	return count > 0, nil
}

func resetSchemaObjectExistsTx(tx *sql.Tx, name string) (bool, error) {
	return resetSchemaObjectExists(tx, name)
}

func resetTableRowCountTx(tx *sql.Tx, table string) (int64, error) {
	var count int64
	if err := tx.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
		return 0, fmt.Errorf("count Realm source reset table %s: %w", table, err)
	}
	return count, nil
}

func deleteResetRowsByValuesTx(ctx context.Context, tx *sql.Tx, table, column string, values []string) (int64, error) {
	if len(values) == 0 {
		return 0, nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, table)
	if err != nil || !exists {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE "+column+" IN ("+resetSQLPlaceholders(len(values))+")", resetStringsToAny(values)...)
	if err != nil {
		return 0, fmt.Errorf("delete Realm source reset rows from %s: %w", table, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count deleted Realm source reset rows from %s: %w", table, err)
	}
	return deleted, nil
}

func countResetRowsByValuesTx(tx *sql.Tx, table, column string, values []string) (int64, error) {
	if len(values) == 0 {
		return 0, nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, table)
	if err != nil || !exists {
		return 0, err
	}
	var count int64
	if err := tx.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE "+column+" IN ("+resetSQLPlaceholders(len(values))+")", resetStringsToAny(values)...).Scan(&count); err != nil {
		return 0, fmt.Errorf("read back Realm source reset rows from %s: %w", table, err)
	}
	return count, nil
}

func resetSQLPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func resetStringsToAny(values []string) []any {
	args := make([]any, len(values))
	for index, value := range values {
		args[index] = value
	}
	return args
}
