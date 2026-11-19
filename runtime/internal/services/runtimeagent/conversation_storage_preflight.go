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
	err := runtimepersistence.InspectStoredDatabase(localStatePath, func(db *sql.DB) error { return ValidateConversationStorage(db, false) })
	refusal, _ := storedformat.As(err)
	return refusal
}

// ValidateConversationStorage reads the primary header on startup and validates
// the complete isolated candidate before recovery takes ownership.
func ValidateConversationStorage(db *sql.DB, recovery bool) error {
	var tables int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type='table' AND name='runtime_local_agent_meta'`).Scan(&tables); err != nil || tables == 0 {
		return err
	}
	var retired int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_info('runtime_conversation_anchor') WHERE name='anchor_json'
		AND NOT EXISTS (SELECT 1 FROM pragma_table_info('runtime_conversation_anchor') WHERE name='through_sequence')`).Scan(&retired); err != nil {
		return err
	}
	if retired != 0 {
		return conversationStorageConversionRefusal()
	}
	var raw string
	if err := db.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var persisted persistedPublicChatSurfaceState
	var err error
	if recovery {
		persisted, err = readConversationRows(db, raw)
	} else {
		persisted, _, err = readConversationHeaders(db, raw)
	}
	if err != nil {
		return err
	}
	if err := validatePersistedPublicChatConversationSingletons(persisted.Anchors); err != nil {
		return conversationStateRepairRefusal(err)
	}
	return nil
}
