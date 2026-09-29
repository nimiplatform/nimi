package runtimeagent

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/storedformat"
)

// conversationStorageOwner names this owner in stored-data refusals.
const conversationStorageOwner = "runtimeagent.conversation"

func conversationStorageConversionRefusal() *storedformat.Refusal {
	return storedformat.Refuse(conversationStorageOwner, storedformat.OfflineConversion,
		errors.New("conversation storage requires explicit offline conversion: run runtime:convert-chat-storage with the stopped Runtime database"))
}

func conversationStateRepairRefusal(cause error) *storedformat.Refusal {
	return storedformat.Refuse(conversationStorageOwner, storedformat.OfflineRepair,
		fmt.Errorf("public chat surface state requires explicit offline repair with runtime:repair-local-agent-chat while Runtime is stopped: %w", cause))
}

// @nimi-authority: rule.nimi.runtime.service-operations.r092
// PreflightStoredConversation classifies, read-only and before any owner opens
// the root, whether the conversation storage under localStatePath is one this
// Runtime refuses to open. It returns a refusal only for this owner's own
// classification, using the same checks as the ordinary load; no database,
// unreadable rows, or data the ordinary load rejects for another reason return
// nil so that load reports them unchanged and they are never misattributed.
func PreflightStoredConversation(localStatePath string) *storedformat.Refusal {
	db, exists, err := runtimepersistence.OpenReadOnlyForClassification(localStatePath)
	if err != nil || !exists || db == nil {
		return nil
	}
	defer func() { _ = db.Close() }()
	return classifyStoredConversation(db)
}

func classifyStoredConversation(db *sql.DB) *storedformat.Refusal {
	var raw string
	if err := db.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&raw); err != nil {
		return nil
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	persisted, err := readConversationRows(db, raw)
	if refusal, ok := storedformat.As(err); ok {
		return refusal
	}
	if err != nil {
		return nil
	}
	if err := validatePersistedPublicChatConversationSingletons(persisted.Anchors); err != nil {
		return conversationStateRepairRefusal(err)
	}
	return nil
}
