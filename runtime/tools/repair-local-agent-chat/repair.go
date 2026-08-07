package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	publicChatSurfaceStateKey    = "public_chat_surface_state"
	publicChatSurfaceVersionKey  = "public_chat_surface_version"
	conversationAnchorMetaPrefix = "public_chat_anchor_metadata:"
	conversationAnchorActive     = uint64(1)
	conversationAnchorClosed     = uint64(2)
)

var errPublicChatStateUninitialized = errors.New("Runtime public-chat state is not initialized")

var latestProjectionFields = []string{
	"callerAppId",
	"registeredAppSubject",
	"subjectUserId",
	"threadId",
	"binding",
	"bindings",
	"configRevision",
	"maxTokens",
	"reasoning",
	"activeTurnSnapshot",
	"lastTurnSnapshot",
	"pendingFollowUpId",
	"status",
	"lastTurnId",
	"lastMessageId",
	"updatedAt",
}

var canonicalAnchorProjectionFields = []string{
	"activeTurnSnapshot",
	"lastTurnSnapshot",
	"completedTurnSnapshots",
}

type repairOptions struct {
	DBPath             string
	BackupPath         string
	Apply              bool
	AllowUninitialized bool
	Now                time.Time
}

type repairResult struct {
	Applicable               bool
	SkipReason               string
	Applied                  bool
	BackupPath               string
	OriginalVersion          uint64
	RepairedVersion          uint64
	DuplicateGroups          []duplicateGroupResult
	ReactivatedAnchorIDs     []string
	RewrittenAnchorRefs      int
	RewrittenTargetRefs      int
	RewrittenFollowUpRefs    int
	RewrittenAvatarRefs      int
	RemovedAnchorMetadataKey []string
}

type duplicateGroupResult struct {
	OwnerUserID       string
	LocalAgentRef     string
	CanonicalAnchorID string
	RemovedAnchorIDs  []string
	MergedTurnCount   int
}

type repairPlan struct {
	raw                      []byte
	originalVersion          uint64
	repairedVersion          uint64
	groups                   []duplicateGroupResult
	reactivatedAnchorIDs     []string
	rewrittenAnchorRefs      int
	rewrittenTargetRefs      int
	rewrittenFollowUpRefs    int
	rewrittenAvatarRefs      int
	removedAnchorMetadataKey []string
}

type anchorDocument struct {
	fields           map[string]json.RawMessage
	id               string
	agentID          string
	ownerUserID      string
	localAgentRef    string
	runtimeSourceRef string
	createdAt        time.Time
	updatedAt        time.Time
}

type transcriptTurnDocument struct {
	fields        map[string]json.RawMessage
	turnID        string
	origin        string
	inputText     string
	assistantText string
}

type storedChatState struct {
	raw        string
	versionRaw string
	version    uint64
}

func repairDatabase(ctx context.Context, options repairOptions) (repairResult, error) {
	dbPath, err := validateDatabasePath(options.DBPath)
	if err != nil {
		return repairResult{}, err
	}
	now := options.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	db, err := openRepairDatabase(dbPath, options.Apply)
	if err != nil {
		return repairResult{}, err
	}
	defer func() { _ = db.Close() }()

	if err := checkDatabaseIntegrity(ctx, db); err != nil {
		return repairResult{}, err
	}
	stored, err := readStoredChatState(ctx, db)
	if err != nil {
		if options.AllowUninitialized && errors.Is(err, errPublicChatStateUninitialized) {
			return repairResult{
				Applicable: false,
				SkipReason: "public_chat_state_uninitialized",
			}, nil
		}
		return repairResult{}, err
	}
	plan, err := buildRepairPlan([]byte(stored.raw), stored.version, now)
	if err != nil {
		return repairResult{}, err
	}
	result := resultFromPlan(plan)
	if !plan.hasChanges() || !options.Apply {
		return result, nil
	}

	backupPath, err := resolveBackupPath(dbPath, options.BackupPath, now)
	if err != nil {
		return repairResult{}, err
	}
	if err := createSQLiteBackup(ctx, db, backupPath); err != nil {
		return repairResult{}, err
	}
	if err := verifySQLiteBackup(ctx, backupPath, stored); err != nil {
		return repairResult{}, err
	}
	if err := applyRepairPlan(ctx, db, stored, plan); err != nil {
		return repairResult{}, err
	}
	result.Applied = true
	result.BackupPath = backupPath
	return result, nil
}

func resultFromPlan(plan repairPlan) repairResult {
	return repairResult{
		Applicable:               true,
		OriginalVersion:          plan.originalVersion,
		RepairedVersion:          plan.repairedVersion,
		DuplicateGroups:          append([]duplicateGroupResult(nil), plan.groups...),
		ReactivatedAnchorIDs:     append([]string(nil), plan.reactivatedAnchorIDs...),
		RewrittenAnchorRefs:      plan.rewrittenAnchorRefs,
		RewrittenTargetRefs:      plan.rewrittenTargetRefs,
		RewrittenFollowUpRefs:    plan.rewrittenFollowUpRefs,
		RewrittenAvatarRefs:      plan.rewrittenAvatarRefs,
		RemovedAnchorMetadataKey: append([]string(nil), plan.removedAnchorMetadataKey...),
	}
}

func (p repairPlan) hasChanges() bool {
	return len(p.groups) != 0 || len(p.reactivatedAnchorIDs) != 0 ||
		p.rewrittenAnchorRefs != 0 || p.rewrittenTargetRefs != 0
}

func validateDatabasePath(input string) (string, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", fmt.Errorf("explicit --db path is required")
	}
	absolute, err := filepath.Abs(trimmed)
	if err != nil {
		return "", fmt.Errorf("resolve SQLite path: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("stat SQLite path: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("SQLite path is not a regular file: %s", absolute)
	}
	return filepath.Clean(absolute), nil
}

func openRepairDatabase(path string, apply bool) (*sql.DB, error) {
	mode := "ro"
	if apply {
		mode = "rw"
	}
	dsn := fmt.Sprintf(
		"file:%s?mode=%s&_pragma=busy_timeout(1000)&_pragma=foreign_keys(ON)",
		filepath.ToSlash(path),
		mode,
	)
	if apply {
		dsn += "&_txlock=immediate"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open Runtime SQLite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping Runtime SQLite: %w", err)
	}
	return db, nil
}

func checkDatabaseIntegrity(ctx context.Context, db *sql.DB) error {
	var outcome string
	if err := db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&outcome); err != nil {
		return fmt.Errorf("check Runtime SQLite integrity: %w", err)
	}
	if strings.TrimSpace(outcome) != "ok" {
		return fmt.Errorf("Runtime SQLite integrity check failed: %s", outcome)
	}
	return nil
}

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readStoredChatState(ctx context.Context, queryer rowQueryer) (storedChatState, error) {
	var stored storedChatState
	err := queryer.QueryRowContext(
		ctx,
		`SELECT value FROM runtime_local_agent_meta WHERE key = ?`,
		publicChatSurfaceStateKey,
	).Scan(&stored.raw)
	if errors.Is(err, sql.ErrNoRows) {
		return storedChatState{}, fmt.Errorf(
			"%w: Runtime SQLite has no %q state",
			errPublicChatStateUninitialized,
			publicChatSurfaceStateKey,
		)
	}
	if err != nil {
		return storedChatState{}, fmt.Errorf("read Runtime public-chat state: %w", err)
	}
	err = queryer.QueryRowContext(
		ctx,
		`SELECT value FROM runtime_local_agent_meta WHERE key = ?`,
		publicChatSurfaceVersionKey,
	).Scan(&stored.versionRaw)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return storedChatState{}, fmt.Errorf("read Runtime public-chat version: %w", err)
	}
	if strings.TrimSpace(stored.versionRaw) != "" {
		version, parseErr := strconv.ParseUint(strings.TrimSpace(stored.versionRaw), 10, 64)
		if parseErr != nil {
			return storedChatState{}, fmt.Errorf("parse Runtime public-chat version: %w", parseErr)
		}
		stored.version = version
	}
	return stored, nil
}

func resolveBackupPath(dbPath string, requested string, now time.Time) (string, error) {
	backupPath := strings.TrimSpace(requested)
	if backupPath == "" {
		backupPath = dbPath + ".pre-local-agent-chat-repair-" + now.UTC().Format("20060102T150405.000000000Z") + ".sqlite"
	}
	absolute, err := filepath.Abs(backupPath)
	if err != nil {
		return "", fmt.Errorf("resolve SQLite backup path: %w", err)
	}
	absolute = filepath.Clean(absolute)
	if strings.EqualFold(absolute, filepath.Clean(dbPath)) {
		return "", fmt.Errorf("SQLite backup path must differ from --db")
	}
	if _, err := os.Stat(absolute); err == nil {
		return "", fmt.Errorf("SQLite backup already exists: %s", absolute)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("stat SQLite backup path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return "", fmt.Errorf("create SQLite backup directory: %w", err)
	}
	return absolute, nil
}

func createSQLiteBackup(ctx context.Context, db *sql.DB, backupPath string) error {
	quotedPath := "'" + strings.ReplaceAll(filepath.ToSlash(backupPath), "'", "''") + "'"
	if _, err := db.ExecContext(ctx, `VACUUM main INTO `+quotedPath); err != nil {
		return fmt.Errorf("create pre-repair SQLite backup: %w", err)
	}
	info, err := os.Stat(backupPath)
	if err != nil {
		return fmt.Errorf("verify pre-repair SQLite backup: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return fmt.Errorf("pre-repair SQLite backup is empty or invalid: %s", backupPath)
	}
	return nil
}

func verifySQLiteBackup(ctx context.Context, backupPath string, original storedChatState) error {
	backupDB, err := openRepairDatabase(backupPath, false)
	if err != nil {
		return fmt.Errorf("open pre-repair SQLite backup: %w", err)
	}
	defer func() { _ = backupDB.Close() }()
	if err := checkDatabaseIntegrity(ctx, backupDB); err != nil {
		return fmt.Errorf("verify pre-repair SQLite backup: %w", err)
	}
	stored, err := readStoredChatState(ctx, backupDB)
	if err != nil {
		return fmt.Errorf("read pre-repair SQLite backup: %w", err)
	}
	if stored.raw != original.raw || stored.versionRaw != original.versionRaw {
		return fmt.Errorf("pre-repair SQLite backup does not match the source public-chat state")
	}
	return nil
}

func applyRepairPlan(ctx context.Context, db *sql.DB, original storedChatState, plan repairPlan) (err error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire exclusive Runtime SQLite connection: %w", err)
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, `BEGIN EXCLUSIVE`); err != nil {
		return fmt.Errorf("acquire exclusive Runtime SQLite transaction; confirm the Runtime service is stopped: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()

	current, err := readStoredChatState(ctx, conn)
	if err != nil {
		return err
	}
	if current.raw != original.raw || current.versionRaw != original.versionRaw {
		return fmt.Errorf("Runtime public-chat state changed after backup; no repair was applied")
	}
	if _, err := conn.ExecContext(
		ctx,
		`UPDATE runtime_local_agent_meta SET value = ? WHERE key = ?`,
		string(plan.raw),
		publicChatSurfaceStateKey,
	); err != nil {
		return fmt.Errorf("write repaired Runtime public-chat state: %w", err)
	}
	if _, err := conn.ExecContext(
		ctx,
		`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		publicChatSurfaceVersionKey,
		strconv.FormatUint(plan.repairedVersion, 10),
	); err != nil {
		return fmt.Errorf("write repaired Runtime public-chat version: %w", err)
	}
	for _, key := range plan.removedAnchorMetadataKey {
		if _, err := conn.ExecContext(
			ctx,
			`DELETE FROM runtime_local_agent_meta WHERE key = ?`,
			key,
		); err != nil {
			return fmt.Errorf("remove duplicate conversation-anchor metadata %q: %w", key, err)
		}
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("commit Runtime public-chat repair: %w", err)
	}
	committed = true
	return nil
}

func buildRepairPlan(raw []byte, persistedVersion uint64, now time.Time) (repairPlan, error) {
	root, err := decodeJSONObject(raw, "public-chat state")
	if err != nil {
		return repairPlan{}, err
	}
	rewrittenTargetRefs, err := rewriteLegacyExecutionTargetRefs(root)
	if err != nil {
		return repairPlan{}, err
	}
	stateVersion, err := decodeOptionalUint64(root["version"], "public-chat state version")
	if err != nil {
		return repairPlan{}, err
	}
	originalVersion := stateVersion
	if persistedVersion > originalVersion {
		originalVersion = persistedVersion
	}
	anchorFields, err := decodeObjectArray(root["anchors"], "public-chat anchors")
	if err != nil {
		return repairPlan{}, err
	}
	anchors := make([]*anchorDocument, 0, len(anchorFields))
	byID := make(map[string]*anchorDocument, len(anchorFields))
	groups := make(map[string][]*anchorDocument)
	for _, fields := range anchorFields {
		anchor, parseErr := parseAnchorDocument(fields)
		if parseErr != nil {
			return repairPlan{}, parseErr
		}
		if existing := byID[anchor.id]; existing != nil {
			return repairPlan{}, fmt.Errorf("duplicate conversationAnchorId %q in public-chat state", anchor.id)
		}
		byID[anchor.id] = anchor
		anchors = append(anchors, anchor)
		key := anchor.ownerUserID + "\x00" + anchor.localAgentRef
		groups[key] = append(groups[key], anchor)
	}

	groupKeys := make([]string, 0, len(groups))
	for key, group := range groups {
		if len(group) > 1 {
			groupKeys = append(groupKeys, key)
		}
	}
	sort.Strings(groupKeys)

	replacements := make(map[string]string)
	removedIDs := make(map[string]struct{})
	groupResults := make([]duplicateGroupResult, 0, len(groupKeys))
	for _, key := range groupKeys {
		result, mergeErr := mergeDuplicateAnchorGroup(groups[key], replacements, removedIDs)
		if mergeErr != nil {
			return repairPlan{}, mergeErr
		}
		groupResults = append(groupResults, result)
	}

	reactivatedAnchorIDs := make([]string, 0)
	rewrittenAnchorRefs := 0
	repairedAnchors := make([]map[string]json.RawMessage, 0, len(anchors)-len(removedIDs))
	for _, anchor := range anchors {
		if _, remove := removedIDs[anchor.id]; remove {
			continue
		}
		statusValue, statusErr := decodeOptionalUint64(anchor.fields["status"], "conversation anchor status")
		if statusErr != nil {
			return repairPlan{}, fmt.Errorf("parse persisted conversation anchor %q: %w", anchor.id, statusErr)
		}
		switch statusValue {
		case 0, conversationAnchorActive:
		case conversationAnchorClosed:
			anchor.fields["status"], _ = json.Marshal(conversationAnchorActive)
			reactivatedAnchorIDs = append(reactivatedAnchorIDs, anchor.id)
		default:
			return repairPlan{}, fmt.Errorf(
				"persisted conversation anchor %q has unsupported status %d",
				anchor.id,
				statusValue,
			)
		}
		rewritten, rewriteErr := rewriteCanonicalAnchorProjectionReferences(anchor.fields, anchor.id)
		if rewriteErr != nil {
			return repairPlan{}, fmt.Errorf(
				"rewrite canonical conversation anchor %q projection references: %w",
				anchor.id,
				rewriteErr,
			)
		}
		rewrittenAnchorRefs += rewritten
		repairedAnchors = append(repairedAnchors, anchor.fields)
	}
	sort.Strings(reactivatedAnchorIDs)
	if len(groupKeys) == 0 && len(reactivatedAnchorIDs) == 0 && rewrittenAnchorRefs == 0 && rewrittenTargetRefs == 0 {
		return repairPlan{raw: append([]byte(nil), raw...), originalVersion: originalVersion, repairedVersion: originalVersion}, nil
	}
	root["anchors"], err = json.Marshal(repairedAnchors)
	if err != nil {
		return repairPlan{}, fmt.Errorf("marshal repaired public-chat anchors: %w", err)
	}

	followUps, err := decodeObjectArray(root["followUps"], "public-chat follow-ups")
	if err != nil {
		return repairPlan{}, err
	}
	rewrittenFollowUpRefs, err := rewriteAnchorReferencesInDocuments(followUps, replacements)
	if err != nil {
		return repairPlan{}, fmt.Errorf("rewrite public-chat follow-ups: %w", err)
	}
	root["followUps"], err = json.Marshal(followUps)
	if err != nil {
		return repairPlan{}, fmt.Errorf("marshal repaired public-chat follow-ups: %w", err)
	}

	avatarBindings, err := decodeObjectArray(root["avatarLiveInstances"], "Avatar live-instance bindings")
	if err != nil {
		return repairPlan{}, err
	}
	rewrittenAvatarRefs, err := rewriteAnchorReferencesInDocuments(avatarBindings, replacements)
	if err != nil {
		return repairPlan{}, fmt.Errorf("rewrite Avatar live-instance bindings: %w", err)
	}
	root["avatarLiveInstances"], err = json.Marshal(avatarBindings)
	if err != nil {
		return repairPlan{}, fmt.Errorf("marshal repaired Avatar live-instance bindings: %w", err)
	}

	repairedVersion := originalVersion + 1
	if repairedVersion == 0 {
		return repairPlan{}, fmt.Errorf("public-chat state version overflow")
	}
	root["version"], _ = json.Marshal(repairedVersion)
	root["savedAt"], _ = json.Marshal(now.UTC().Format(time.RFC3339Nano))
	repairedRaw, err := json.Marshal(root)
	if err != nil {
		return repairPlan{}, fmt.Errorf("marshal repaired public-chat state: %w", err)
	}
	metadataKeys := make([]string, 0, len(removedIDs))
	for id := range removedIDs {
		metadataKeys = append(metadataKeys, conversationAnchorMetaPrefix+id)
	}
	sort.Strings(metadataKeys)
	return repairPlan{
		raw:                      repairedRaw,
		originalVersion:          originalVersion,
		repairedVersion:          repairedVersion,
		groups:                   groupResults,
		reactivatedAnchorIDs:     reactivatedAnchorIDs,
		rewrittenAnchorRefs:      rewrittenAnchorRefs,
		rewrittenTargetRefs:      rewrittenTargetRefs,
		rewrittenFollowUpRefs:    rewrittenFollowUpRefs,
		rewrittenAvatarRefs:      rewrittenAvatarRefs,
		removedAnchorMetadataKey: metadataKeys,
	}, nil
}

func rewriteLegacyExecutionTargetRefs(root map[string]json.RawMessage) (int, error) {
	count := 0
	for key, value := range root {
		rewritten, rewrittenCount, err := rewriteLegacyExecutionTargetRefsJSON(value)
		if err != nil {
			return 0, fmt.Errorf("rewrite legacy execution target refs in %s: %w", key, err)
		}
		root[key] = rewritten
		count += rewrittenCount
	}
	return count, nil
}

func rewriteLegacyExecutionTargetRefsJSON(raw json.RawMessage) (json.RawMessage, int, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return append(json.RawMessage(nil), raw...), 0, nil
	}
	switch trimmed[0] {
	case '{':
		fields, err := decodeJSONObject(trimmed, "execution target-ref container")
		if err != nil {
			return nil, 0, err
		}
		count := 0
		for key, value := range fields {
			if key == "TargetRef" || key == "targetRef" || key == "target_ref" {
				rewritten, changed, rewriteErr := rewriteLegacyExecutionTargetRef(value)
				if rewriteErr != nil {
					return nil, 0, fmt.Errorf("%s: %w", key, rewriteErr)
				}
				fields[key] = rewritten
				if changed {
					count++
				}
				continue
			}
			rewritten, rewrittenCount, rewriteErr := rewriteLegacyExecutionTargetRefsJSON(value)
			if rewriteErr != nil {
				return nil, 0, rewriteErr
			}
			fields[key] = rewritten
			count += rewrittenCount
		}
		out, err := json.Marshal(fields)
		return out, count, err
	case '[':
		var items []json.RawMessage
		if err := decodeJSON(trimmed, &items, "execution target-ref container array"); err != nil {
			return nil, 0, err
		}
		count := 0
		for index, item := range items {
			rewritten, rewrittenCount, err := rewriteLegacyExecutionTargetRefsJSON(item)
			if err != nil {
				return nil, 0, err
			}
			items[index] = rewritten
			count += rewrittenCount
		}
		out, err := json.Marshal(items)
		return out, count, err
	default:
		return append(json.RawMessage(nil), raw...), 0, nil
	}
}

func rewriteLegacyExecutionTargetRef(raw json.RawMessage) (json.RawMessage, bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return append(json.RawMessage(nil), raw...), false, nil
	}
	fields, err := decodeJSONObject(trimmed, "execution target_ref")
	if err != nil {
		return nil, false, err
	}
	if localRaw, exists := fields["local_runtime"]; exists {
		if len(fields) != 1 {
			return nil, false, fmt.Errorf("legacy local_runtime target_ref must contain exactly one target")
		}
		local, err := decodeJSONObject(localRaw, "legacy local_runtime target_ref")
		if err != nil {
			return nil, false, err
		}
		if err := requireOnlyFields(local, "version", "profile_binding_id", "readiness_ref"); err != nil {
			return nil, false, err
		}
		profileBindingID, err := optionalTrimmedString(local, "profile_binding_id")
		if err != nil {
			return nil, false, err
		}
		readinessRef, err := optionalTrimmedString(local, "readiness_ref")
		if err != nil {
			return nil, false, err
		}
		if (profileBindingID != "") == (readinessRef != "") {
			return nil, false, fmt.Errorf("legacy local_runtime target_ref must contain exactly one binding reference")
		}
		canonical := map[string]any{}
		if profileBindingID != "" {
			canonical["profileBindingId"] = profileBindingID
		} else {
			canonical["readinessRef"] = readinessRef
		}
		out, err := json.Marshal(map[string]any{"local": canonical})
		return out, true, err
	}
	cloudRaw, exists := fields["cloud"]
	if !exists {
		return append(json.RawMessage(nil), raw...), false, nil
	}
	cloud, err := decodeJSONObject(cloudRaw, "execution cloud target_ref")
	if err != nil {
		return nil, false, err
	}
	if _, legacy := cloud["connector_id"]; !legacy {
		return append(json.RawMessage(nil), raw...), false, nil
	}
	if len(fields) != 1 {
		return nil, false, fmt.Errorf("legacy cloud target_ref must contain exactly one target")
	}
	if err := requireOnlyFields(cloud, "version", "connector_id", "remote_model_catalog_id", "provider_model_id", "provider"); err != nil {
		return nil, false, err
	}
	connectorID, err := requiredString(cloud, "connector_id")
	if err != nil {
		return nil, false, err
	}
	remoteModelCatalogID, err := requiredString(cloud, "remote_model_catalog_id")
	if err != nil {
		return nil, false, err
	}
	providerModelID, err := requiredString(cloud, "provider_model_id")
	if err != nil {
		return nil, false, err
	}
	provider, err := requiredString(cloud, "provider")
	if err != nil {
		return nil, false, err
	}
	out, err := json.Marshal(map[string]any{"cloud": map[string]any{
		"connectorId":          connectorID,
		"remoteModelCatalogId": remoteModelCatalogID,
		"providerModelId":      providerModelID,
		"provider":             provider,
	}})
	return out, true, err
}

func requireOnlyFields(fields map[string]json.RawMessage, allowed ...string) error {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	for key := range fields {
		if _, ok := allowedSet[key]; !ok {
			return fmt.Errorf("legacy target_ref contains unsupported field %q", key)
		}
	}
	return nil
}

func optionalTrimmedString(fields map[string]json.RawMessage, key string) (string, error) {
	raw, exists := fields[key]
	if !exists || len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var value string
	if err := decodeJSON(raw, &value, key); err != nil {
		return "", err
	}
	if value != strings.TrimSpace(value) {
		return "", fmt.Errorf("%s must be trimmed", key)
	}
	return value, nil
}

func parseAnchorDocument(fields map[string]json.RawMessage) (*anchorDocument, error) {
	id, err := requiredString(fields, "conversationAnchorId")
	if err != nil {
		return nil, fmt.Errorf("parse persisted conversation anchor: %w", err)
	}
	agentID, err := requiredString(fields, "agentId")
	if err != nil {
		return nil, fmt.Errorf("parse persisted conversation anchor %q: %w", id, err)
	}
	ownerUserID, err := requiredString(fields, "ownerUserId")
	if err != nil {
		return nil, fmt.Errorf("parse persisted conversation anchor %q: %w", id, err)
	}
	localAgentRef, err := requiredString(fields, "localAgentRef")
	if err != nil {
		return nil, fmt.Errorf("parse persisted conversation anchor %q: %w", id, err)
	}
	runtimeSourceRef, err := requiredString(fields, "runtimeSourceRef")
	if err != nil {
		return nil, fmt.Errorf("parse persisted conversation anchor %q: %w", id, err)
	}
	return &anchorDocument{
		fields:           fields,
		id:               id,
		agentID:          agentID,
		ownerUserID:      ownerUserID,
		localAgentRef:    localAgentRef,
		runtimeSourceRef: runtimeSourceRef,
	}, nil
}

func mergeDuplicateAnchorGroup(
	group []*anchorDocument,
	replacements map[string]string,
	removedIDs map[string]struct{},
) (duplicateGroupResult, error) {
	if len(group) < 2 {
		return duplicateGroupResult{}, fmt.Errorf("repair duplicate group requires at least two anchors")
	}
	ordered := append([]*anchorDocument(nil), group...)
	for _, anchor := range ordered {
		createdAt, err := requiredRFC3339(anchor.fields, "createdAt")
		if err != nil {
			return duplicateGroupResult{}, fmt.Errorf("choose earliest-created canonical anchor %q: %w", anchor.id, err)
		}
		anchor.createdAt = createdAt
		updatedAt, err := optionalRFC3339(anchor.fields, "updatedAt")
		if err != nil {
			return duplicateGroupResult{}, fmt.Errorf("choose latest projection for anchor %q: %w", anchor.id, err)
		}
		if updatedAt.IsZero() {
			updatedAt = createdAt
		}
		anchor.updatedAt = updatedAt
	}
	sort.Slice(ordered, func(i, j int) bool {
		if !ordered[i].createdAt.Equal(ordered[j].createdAt) {
			return ordered[i].createdAt.Before(ordered[j].createdAt)
		}
		return ordered[i].id < ordered[j].id
	})
	canonical := ordered[0]
	for _, anchor := range ordered[1:] {
		if anchor.agentID != canonical.agentID || anchor.runtimeSourceRef != canonical.runtimeSourceRef {
			return duplicateGroupResult{}, fmt.Errorf(
				"duplicate anchors %q and %q have conflicting LocalAgent identity",
				canonical.id,
				anchor.id,
			)
		}
	}
	latest := ordered[0]
	for _, candidate := range ordered[1:] {
		if candidate.updatedAt.After(latest.updatedAt) ||
			(candidate.updatedAt.Equal(latest.updatedAt) && candidate.createdAt.After(latest.createdAt)) ||
			(candidate.updatedAt.Equal(latest.updatedAt) && candidate.createdAt.Equal(latest.createdAt) && candidate.id < latest.id) {
			latest = candidate
		}
	}

	mergedTranscript, err := mergeTranscripts(ordered)
	if err != nil {
		return duplicateGroupResult{}, err
	}
	canonical.fields["committedTranscript"], err = json.Marshal(mergedTranscript)
	if err != nil {
		return duplicateGroupResult{}, fmt.Errorf("marshal merged transcript for %q: %w", canonical.id, err)
	}
	copyLatestProjection(canonical.fields, latest.fields)
	canonical.fields["updatedAt"], _ = json.Marshal(latest.updatedAt.UTC().Format(time.RFC3339Nano))
	if err := mergeCompletedTurnSnapshots(canonical.fields, ordered); err != nil {
		return duplicateGroupResult{}, err
	}

	removed := make([]string, 0, len(ordered)-1)
	for _, anchor := range ordered[1:] {
		replacements[anchor.id] = canonical.id
		removedIDs[anchor.id] = struct{}{}
		removed = append(removed, anchor.id)
	}
	sort.Strings(removed)
	return duplicateGroupResult{
		OwnerUserID:       canonical.ownerUserID,
		LocalAgentRef:     canonical.localAgentRef,
		CanonicalAnchorID: canonical.id,
		RemovedAnchorIDs:  removed,
		MergedTurnCount:   len(mergedTranscript),
	}, nil
}

func mergeTranscripts(ordered []*anchorDocument) ([]map[string]json.RawMessage, error) {
	merged := make([]map[string]json.RawMessage, 0)
	byTurnID := make(map[string]*transcriptTurnDocument)
	for _, anchor := range ordered {
		turns, err := parseTranscript(anchor)
		if err != nil {
			return nil, err
		}
		for _, turn := range turns {
			existing := byTurnID[turn.turnID]
			if existing != nil {
				if existing.origin != turn.origin ||
					existing.inputText != turn.inputText ||
					existing.assistantText != turn.assistantText {
					return nil, fmt.Errorf(
						"conversation turn %q has conflicting content across duplicate anchors",
						turn.turnID,
					)
				}
				continue
			}
			byTurnID[turn.turnID] = turn
			merged = append(merged, turn.fields)
		}
	}
	for index, fields := range merged {
		fields["sequence"], _ = json.Marshal(uint64(index))
	}
	return merged, nil
}

func parseTranscript(anchor *anchorDocument) ([]*transcriptTurnDocument, error) {
	raw := bytes.TrimSpace(anchor.fields["committedTranscript"])
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	var items []json.RawMessage
	if err := decodeJSON(raw, &items, "committedTranscript"); err != nil {
		return nil, fmt.Errorf("parse transcript for anchor %q: %w", anchor.id, err)
	}
	turns := make([]*transcriptTurnDocument, 0, len(items))
	for index, item := range items {
		fields, err := decodeJSONObject(item, "committed transcript turn")
		if err != nil {
			return nil, fmt.Errorf("parse transcript for anchor %q: %w", anchor.id, err)
		}
		turnID, err := requiredString(fields, "turnId")
		if err != nil {
			return nil, fmt.Errorf("parse transcript for anchor %q: %w", anchor.id, err)
		}
		origin, err := requiredString(fields, "origin")
		if err != nil {
			return nil, fmt.Errorf("parse transcript turn %q: %w", turnID, err)
		}
		if origin != "user" && origin != "follow_up" {
			return nil, fmt.Errorf("parse transcript turn %q: invalid origin %q", turnID, origin)
		}
		inputText, err := requiredString(fields, "inputText")
		if err != nil {
			return nil, fmt.Errorf("parse transcript turn %q: %w", turnID, err)
		}
		assistantText, err := requiredString(fields, "assistantText")
		if err != nil {
			return nil, fmt.Errorf("parse transcript turn %q: %w", turnID, err)
		}
		sequence, err := decodeOptionalUint64(fields["sequence"], "transcript sequence")
		if err != nil || sequence != uint64(index) {
			return nil, fmt.Errorf("parse transcript turn %q: invalid sequence", turnID)
		}
		turns = append(turns, &transcriptTurnDocument{
			fields:        fields,
			turnID:        turnID,
			origin:        origin,
			inputText:     inputText,
			assistantText: assistantText,
		})
	}
	return turns, nil
}

func copyLatestProjection(canonical map[string]json.RawMessage, latest map[string]json.RawMessage) {
	for _, key := range latestProjectionFields {
		if value, exists := latest[key]; exists {
			canonical[key] = append(json.RawMessage(nil), value...)
		} else {
			delete(canonical, key)
		}
	}
}

func mergeCompletedTurnSnapshots(canonical map[string]json.RawMessage, ordered []*anchorDocument) error {
	merged := make(map[string]json.RawMessage)
	for _, anchor := range ordered {
		raw := bytes.TrimSpace(anchor.fields["completedTurnSnapshots"])
		if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
			continue
		}
		var snapshots map[string]json.RawMessage
		if err := decodeJSON(raw, &snapshots, "completedTurnSnapshots"); err != nil {
			return fmt.Errorf("parse completed-turn snapshots for anchor %q: %w", anchor.id, err)
		}
		for turnID, snapshot := range snapshots {
			if strings.TrimSpace(turnID) == "" {
				return fmt.Errorf("anchor %q has an empty completed-turn snapshot id", anchor.id)
			}
			merged[turnID] = append(json.RawMessage(nil), snapshot...)
		}
	}
	if len(merged) == 0 {
		delete(canonical, "completedTurnSnapshots")
		return nil
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return fmt.Errorf("marshal merged completed-turn snapshots: %w", err)
	}
	canonical["completedTurnSnapshots"] = raw
	return nil
}

func rewriteCanonicalAnchorProjectionReferences(
	anchor map[string]json.RawMessage,
	canonicalAnchorID string,
) (int, error) {
	canonicalAnchorID = strings.TrimSpace(canonicalAnchorID)
	if canonicalAnchorID == "" {
		return 0, fmt.Errorf("canonical conversation anchor id is empty")
	}
	count := 0
	for _, field := range canonicalAnchorProjectionFields {
		raw, exists := anchor[field]
		if !exists {
			continue
		}
		rewritten, rewrittenCount, err := rewriteAnchorReferencesToCanonical(raw, canonicalAnchorID)
		if err != nil {
			return 0, fmt.Errorf("%s: %w", field, err)
		}
		anchor[field] = rewritten
		count += rewrittenCount
	}
	return count, nil
}

func rewriteAnchorReferencesToCanonical(
	raw json.RawMessage,
	canonicalAnchorID string,
) (json.RawMessage, int, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return append(json.RawMessage(nil), raw...), 0, nil
	}
	switch trimmed[0] {
	case '{':
		fields, err := decodeJSONObject(trimmed, "canonical anchor projection")
		if err != nil {
			return nil, 0, err
		}
		count := 0
		for key, value := range fields {
			if key == "conversationAnchorId" || key == "conversation_anchor_id" {
				var anchorID string
				if err := decodeJSON(value, &anchorID, key); err != nil {
					return nil, 0, err
				}
				if strings.TrimSpace(anchorID) == "" {
					return nil, 0, fmt.Errorf("%s is empty", key)
				}
				if anchorID != canonicalAnchorID {
					fields[key], _ = json.Marshal(canonicalAnchorID)
					count++
				}
				continue
			}
			rewritten, nestedCount, err := rewriteAnchorReferencesToCanonical(value, canonicalAnchorID)
			if err != nil {
				return nil, 0, err
			}
			fields[key] = rewritten
			count += nestedCount
		}
		out, err := json.Marshal(fields)
		return out, count, err
	case '[':
		var items []json.RawMessage
		if err := decodeJSON(trimmed, &items, "canonical anchor projection array"); err != nil {
			return nil, 0, err
		}
		count := 0
		for index, item := range items {
			rewritten, nestedCount, err := rewriteAnchorReferencesToCanonical(item, canonicalAnchorID)
			if err != nil {
				return nil, 0, err
			}
			items[index] = rewritten
			count += nestedCount
		}
		out, err := json.Marshal(items)
		return out, count, err
	default:
		return append(json.RawMessage(nil), raw...), 0, nil
	}
}

func rewriteAnchorReferencesInDocuments(documents []map[string]json.RawMessage, replacements map[string]string) (int, error) {
	count := 0
	for _, document := range documents {
		raw, err := json.Marshal(document)
		if err != nil {
			return 0, err
		}
		rewritten, rewrittenCount, err := rewriteAnchorReferences(raw, replacements)
		if err != nil {
			return 0, err
		}
		fields, err := decodeJSONObject(rewritten, "rewritten anchor-reference document")
		if err != nil {
			return 0, err
		}
		for key := range document {
			delete(document, key)
		}
		for key, value := range fields {
			document[key] = value
		}
		count += rewrittenCount
	}
	return count, nil
}

func rewriteAnchorReferences(raw json.RawMessage, replacements map[string]string) (json.RawMessage, int, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return append(json.RawMessage(nil), raw...), 0, nil
	}
	switch trimmed[0] {
	case '{':
		fields, err := decodeJSONObject(trimmed, "anchor-reference object")
		if err != nil {
			return nil, 0, err
		}
		count := 0
		for key, value := range fields {
			if key == "conversationAnchorId" || key == "conversation_anchor_id" {
				var anchorID string
				if err := decodeJSON(value, &anchorID, key); err != nil {
					return nil, 0, err
				}
				if canonicalID, replace := replacements[anchorID]; replace {
					fields[key], _ = json.Marshal(canonicalID)
					count++
				}
				continue
			}
			rewritten, nestedCount, err := rewriteAnchorReferences(value, replacements)
			if err != nil {
				return nil, 0, err
			}
			fields[key] = rewritten
			count += nestedCount
		}
		out, err := json.Marshal(fields)
		return out, count, err
	case '[':
		var items []json.RawMessage
		if err := decodeJSON(trimmed, &items, "anchor-reference array"); err != nil {
			return nil, 0, err
		}
		count := 0
		for index, item := range items {
			rewritten, nestedCount, err := rewriteAnchorReferences(item, replacements)
			if err != nil {
				return nil, 0, err
			}
			items[index] = rewritten
			count += nestedCount
		}
		out, err := json.Marshal(items)
		return out, count, err
	default:
		return append(json.RawMessage(nil), raw...), 0, nil
	}
}

func decodeObjectArray(raw json.RawMessage, label string) ([]map[string]json.RawMessage, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var items []json.RawMessage
	if err := decodeJSON(trimmed, &items, label); err != nil {
		return nil, err
	}
	out := make([]map[string]json.RawMessage, 0, len(items))
	for index, item := range items {
		fields, err := decodeJSONObject(item, fmt.Sprintf("%s[%d]", label, index))
		if err != nil {
			return nil, err
		}
		out = append(out, fields)
	}
	return out, nil
}

func decodeJSONObject(raw []byte, label string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := decodeJSON(raw, &fields, label); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, fmt.Errorf("%s must be a JSON object", label)
	}
	return fields, nil
}

func decodeJSON(raw []byte, target any, label string) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode %s: %w", label, err)
	}
	if err := decoder.Decode(&struct{}{}); err == nil {
		return fmt.Errorf("decode %s: trailing JSON content", label)
	} else if !errors.Is(err, io.EOF) {
		return fmt.Errorf("decode %s trailing content: %w", label, err)
	}
	return nil
}

func requiredString(fields map[string]json.RawMessage, key string) (string, error) {
	raw, exists := fields[key]
	if !exists {
		return "", fmt.Errorf("%s is required", key)
	}
	var value string
	if err := decodeJSON(raw, &value, key); err != nil {
		return "", err
	}
	if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
		return "", fmt.Errorf("%s must be a non-empty trimmed string", key)
	}
	return value, nil
}

func requiredRFC3339(fields map[string]json.RawMessage, key string) (time.Time, error) {
	value, err := requiredString(fields, key)
	if err != nil {
		return time.Time{}, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be RFC3339: %w", key, err)
	}
	return parsed.UTC(), nil
}

func optionalRFC3339(fields map[string]json.RawMessage, key string) (time.Time, error) {
	raw, exists := fields[key]
	if !exists || len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return time.Time{}, nil
	}
	var value string
	if err := decodeJSON(raw, &value, key); err != nil {
		return time.Time{}, err
	}
	if strings.TrimSpace(value) == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be RFC3339: %w", key, err)
	}
	return parsed.UTC(), nil
}

func decodeOptionalUint64(raw json.RawMessage, label string) (uint64, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return 0, nil
	}
	var value uint64
	if err := decodeJSON(trimmed, &value, label); err != nil {
		return 0, err
	}
	return value, nil
}
