package runtimeagent

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// agentAtomicProjectionDeletionHook persists every Runtime Agent deletion
// target inside the Memory service's outer transaction. The Memory snapshot
// rewrite and this hook therefore share one SQLite commit/rollback boundary.
func agentAtomicProjectionDeletionHook(
	svc *Service,
	localAgentRef string,
	bankLocatorKeys []string,
	chatSnapshot persistedPublicChatSurfaceState,
	removedAnchorIDs []string,
) (runtimeAgentStateTxHook, error) {
	if svc == nil || svc.stateRepo == nil {
		return nil, fmt.Errorf("runtime agent deletion store is unavailable")
	}
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" {
		return nil, fmt.Errorf("runtime agent deletion local_agent_ref is required")
	}
	chatRaw, err := json.Marshal(chatSnapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal public chat deletion snapshot: %w", err)
	}
	projectionHook := agentProjectionPurgeHook(ref, bankLocatorKeys)
	anchorIDs := uniqueAgentDeletionStrings(removedAnchorIDs)
	return func(tx *sql.Tx) error {
		if projectionHook != nil {
			if err := projectionHook(tx); err != nil {
				return err
			}
		}
		if err := deleteLocalAgentSourceSnapshotTx(tx, ref); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_agent_ai_config WHERE agent_instance_id = ?`, ref); err != nil {
			return fmt.Errorf("delete runtime agent AI config: %w", err)
		}
		// Retain the consumed challenge security ledger, but remove the bounded
		// replay result that points at a deleted LocalAgent. A replay then returns
		// UPLOAD_NOT_FOUND and can never resurrect or project the old identity.
		if _, err := tx.Exec(`DELETE FROM runtime_source_materialization_upload WHERE committed_local_agent_ref = ?`, ref); err != nil {
			return fmt.Errorf("delete source materialization replay result: %w", err)
		}
		for _, anchorID := range anchorIDs {
			if _, err := tx.Exec(`DELETE FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentConversationAnchorMetadataKey(anchorID)); err != nil {
				return fmt.Errorf("delete conversation anchor metadata: %w", err)
			}
		}
		if err := persistPublicChatSurfaceStateTx(tx, chatSnapshot, string(chatRaw)); err != nil {
			return fmt.Errorf("persist public chat deletion snapshot: %w", err)
		}
		return nil
	}, nil
}

func uniqueAgentDeletionStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
