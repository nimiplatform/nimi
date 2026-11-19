package runtimepersistence

// ConversationStorageSchema is shared by fresh initialization and the explicit offline conversion.

func ConversationStorageSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS runtime_conversation_anchor (anchor_id TEXT PRIMARY KEY, version INTEGER NOT NULL, through_sequence INTEGER NOT NULL DEFAULT 0,
			message_count INTEGER NOT NULL DEFAULT 0,title_preview TEXT NOT NULL DEFAULT '',last_role TEXT NOT NULL DEFAULT '',last_preview TEXT NOT NULL DEFAULT '',  local_agent_ref TEXT, anchor_json TEXT)`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_turn (anchor_id TEXT NOT NULL, turn_id TEXT NOT NULL, sequence INTEGER NOT NULL, input_turn_id TEXT NOT NULL,visible_count INTEGER NOT NULL, display_count INTEGER NOT NULL, display_bytes INTEGER NOT NULL, input_bytes INTEGER, answered INTEGER NOT NULL, turn_json TEXT NOT NULL, PRIMARY KEY(anchor_id,turn_id), UNIQUE(anchor_id,sequence))`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_answered ON runtime_conversation_turn(anchor_id,sequence) WHERE json_extract(turn_json,'$.assistantText')<>''`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_turn_input ON runtime_conversation_turn(anchor_id,input_turn_id,sequence)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_owner ON runtime_conversation_anchor(local_agent_ref) WHERE anchor_json IS NOT NULL`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_projection(anchor_id TEXT NOT NULL,turn_id TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,unfinished INTEGER NOT NULL DEFAULT 0,projection_json TEXT,sequence INTEGER,
			projection_order TEXT NOT NULL DEFAULT '', accepted_order TEXT,committed_order TEXT NOT NULL DEFAULT '',
			locate_order TEXT GENERATED ALWAYS AS (coalesce(accepted_order,committed_order)) STORED,
			display_order TEXT GENERATED ALWAYS AS (CASE WHEN sequence IS NULL THEN COALESCE(accepted_order,projection_order) ELSE projection_order END) STORED,PRIMARY KEY(anchor_id,turn_id))`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_incomplete ON runtime_conversation_projection(anchor_id,turn_id) WHERE unfinished=1`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_locate ON runtime_conversation_projection(anchor_id,locate_order,turn_id)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_display ON runtime_conversation_projection(anchor_id,display_order,(sequence IS NULL),sequence,projection_order,turn_id)`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_message_ref(anchor_id TEXT NOT NULL,message_id TEXT NOT NULL,turn_id TEXT NOT NULL,artifact_id TEXT,mime_type TEXT,PRIMARY KEY(anchor_id,message_id))`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_artifact_ref ON runtime_conversation_message_ref(anchor_id,artifact_id) WHERE artifact_id IS NOT NULL`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_voice(anchor_id TEXT NOT NULL,turn_id TEXT NOT NULL,voice_json TEXT NOT NULL,PRIMARY KEY(anchor_id,turn_id))`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_voice_request(anchor_id TEXT NOT NULL,request_key TEXT NOT NULL,turn_id TEXT NOT NULL,PRIMARY KEY(anchor_id,request_key))`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_recovery (anchor_id TEXT NOT NULL, turn_id TEXT NOT NULL, version INTEGER NOT NULL, input_turn_id TEXT NOT NULL,input_bytes INTEGER,public_bytes INTEGER NOT NULL,recovery_json TEXT NOT NULL, PRIMARY KEY(anchor_id,turn_id))`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_request ON runtime_conversation_recovery(anchor_id,json_extract(recovery_json,'$.registeredAppSubject'),json_extract(recovery_json,'$.requestId'))`,
		`CREATE TABLE IF NOT EXISTS runtime_conversation_followup (followup_id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, version INTEGER NOT NULL, followup_json TEXT)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_conversation_followup_anchor ON runtime_conversation_followup(anchor_id)`,
	}
}
