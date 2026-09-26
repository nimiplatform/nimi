package runtimepersistence

// ConversationStorageSchema is shared by fresh initialization and the explicit offline conversion.

func ConversationStorageSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS runtime_conversation_anchor (anchor_id TEXT PRIMARY KEY, version INTEGER NOT NULL, anchor_json TEXT)`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_turn (anchor_id TEXT NOT NULL, sequence INTEGER NOT NULL, turn_json TEXT NOT NULL, PRIMARY KEY(anchor_id,sequence))`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_followup (followup_id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, version INTEGER NOT NULL, followup_json TEXT)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_followup_anchor ON runtime_conversation_followup(anchor_id)`,
	}
}
