package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildRepairPlanMergesDuplicateConversationTruth(t *testing.T) {
	now := time.Date(2026, 7, 31, 8, 0, 0, 0, time.UTC)
	raw := marshalTestState(t, map[string]any{
		"version": 4,
		"savedAt": "2026-07-30T00:00:00Z",
		"futureRootField": map[string]any{
			"preserved": true,
		},
		"anchors": []any{
			withProjectionAnchorRefs(testAnchor(
				"anchor-first",
				"2026-07-29T09:00:00Z",
				"2026-07-29T10:00:00Z",
				"desktop.app",
				[]any{testTurn("turn-1", 0, "hello", "first reply")},
				map[string]any{"turn-1": map[string]any{"status": "completed"}},
			), "anchor-first"),
			withProjectionAnchorRefs(testAnchor(
				"anchor-later",
				"2026-07-30T09:00:00Z",
				"2026-07-30T11:00:00Z",
				"zhiyu.app",
				[]any{
					testTurn("turn-1", 0, "hello", "first reply"),
					testTurn("turn-2", 1, "continue", "second reply"),
				},
				map[string]any{"turn-2": map[string]any{"status": "completed"}},
			), "anchor-later"),
		},
		"followUps": []any{map[string]any{
			"followUpId":           "follow-1",
			"conversationAnchorId": "anchor-later",
			"hookIntent": map[string]any{
				"conversation_anchor_id": "anchor-later",
			},
		}},
		"avatarLiveInstances": []any{map[string]any{
			"avatarInstanceId":     "avatar-1",
			"conversationAnchorId": "anchor-later",
		}},
	})
	plan, err := buildRepairPlan(raw, 9, now)
	if err != nil {
		t.Fatalf("buildRepairPlan: %v", err)
	}
	if plan.originalVersion != 9 || plan.repairedVersion != 10 {
		t.Fatalf("versions: %d -> %d", plan.originalVersion, plan.repairedVersion)
	}
	if len(plan.groups) != 1 {
		t.Fatalf("duplicate groups: %+v", plan.groups)
	}
	group := plan.groups[0]
	if group.CanonicalAnchorID != "anchor-first" ||
		len(group.RemovedAnchorIDs) != 1 ||
		group.RemovedAnchorIDs[0] != "anchor-later" ||
		group.MergedTurnCount != 2 {
		t.Fatalf("repair group: %+v", group)
	}
	if plan.rewrittenFollowUpRefs != 2 || plan.rewrittenAvatarRefs != 1 {
		t.Fatalf("rewritten refs: followups=%d avatar=%d", plan.rewrittenFollowUpRefs, plan.rewrittenAvatarRefs)
	}
	if plan.rewrittenAnchorRefs != 2 {
		t.Fatalf("rewritten canonical anchor refs=%d want=2", plan.rewrittenAnchorRefs)
	}
	if len(plan.removedAnchorMetadataKey) != 1 ||
		plan.removedAnchorMetadataKey[0] != conversationAnchorMetaPrefix+"anchor-later" {
		t.Fatalf("metadata removal: %v", plan.removedAnchorMetadataKey)
	}

	root, err := decodeJSONObject(plan.raw, "repaired state")
	if err != nil {
		t.Fatalf("decode repaired state: %v", err)
	}
	if _, ok := root["futureRootField"]; !ok {
		t.Fatal("unknown root field was not preserved")
	}
	anchors, err := decodeObjectArray(root["anchors"], "anchors")
	if err != nil {
		t.Fatalf("decode repaired anchors: %v", err)
	}
	if len(anchors) != 1 {
		t.Fatalf("repaired anchors: %d", len(anchors))
	}
	if id, _ := requiredString(anchors[0], "conversationAnchorId"); id != "anchor-first" {
		t.Fatalf("canonical anchor id: %q", id)
	}
	if appID, _ := requiredString(anchors[0], "callerAppId"); appID != "zhiyu.app" {
		t.Fatalf("latest projection was not copied: callerAppId=%q", appID)
	}
	if _, ok := anchors[0]["futureAnchorField"]; !ok {
		t.Fatal("unknown canonical anchor field was not preserved")
	}
	status, err := decodeOptionalUint64(anchors[0]["status"], "canonical status")
	if err != nil || status != 1 {
		t.Fatalf("latest active status was not copied to earliest canonical: status=%d err=%v", status, err)
	}
	var turns []map[string]json.RawMessage
	if err := decodeJSON(anchors[0]["committedTranscript"], &turns, "merged transcript"); err != nil {
		t.Fatalf("decode merged transcript: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("merged transcript length: %d", len(turns))
	}
	for index, turn := range turns {
		sequence, err := decodeOptionalUint64(turn["sequence"], "sequence")
		if err != nil || sequence != uint64(index) {
			t.Fatalf("turn %d sequence=%d err=%v", index, sequence, err)
		}
	}
	var completed map[string]json.RawMessage
	if err := decodeJSON(anchors[0]["completedTurnSnapshots"], &completed, "completed snapshots"); err != nil {
		t.Fatalf("decode completed snapshots: %v", err)
	}
	if len(completed) != 2 {
		t.Fatalf("completed snapshots were not merged: %v", completed)
	}
	assertNestedAnchorReference(t, anchors[0]["lastTurnSnapshot"], "anchor-first")
	for turnID, snapshot := range completed {
		assertNestedAnchorReference(t, snapshot, "anchor-first")
		if strings.TrimSpace(turnID) == "" {
			t.Fatal("completed snapshot retained an empty turn id")
		}
	}
	followUps, err := decodeObjectArray(root["followUps"], "followups")
	if err != nil {
		t.Fatalf("decode repaired followups: %v", err)
	}
	assertAnchorReference(t, followUps[0]["conversationAnchorId"], "anchor-first")
	hook, err := decodeJSONObject(followUps[0]["hookIntent"], "hook intent")
	if err != nil {
		t.Fatalf("decode hook intent: %v", err)
	}
	assertAnchorReference(t, hook["conversation_anchor_id"], "anchor-first")
	avatars, err := decodeObjectArray(root["avatarLiveInstances"], "avatars")
	if err != nil {
		t.Fatalf("decode repaired avatars: %v", err)
	}
	assertAnchorReference(t, avatars[0]["conversationAnchorId"], "anchor-first")
}

func TestBuildRepairPlanRepairsStaleProjectionReferenceAfterDuplicatesWereRemoved(t *testing.T) {
	now := time.Date(2026, 7, 31, 8, 30, 0, 0, time.UTC)
	anchor := testAnchor(
		"anchor-first",
		"2026-07-29T09:00:00Z",
		"2026-07-30T11:00:00Z",
		"desktop.app",
		[]any{testTurn("turn-1", 0, "hello", "reply")},
		nil,
	)
	anchor["status"] = 1
	anchor["lastTurnSnapshot"] = map[string]any{
		"status": "completed",
		"contextSummary": map[string]any{
			"conversation_anchor_id": "anchor-removed",
		},
	}
	raw := marshalTestState(t, map[string]any{
		"version":             10,
		"savedAt":             "2026-07-30T11:00:00Z",
		"anchors":             []any{anchor},
		"followUps":           []any{},
		"avatarLiveInstances": []any{},
	})

	plan, err := buildRepairPlan(raw, 10, now)
	if err != nil {
		t.Fatalf("buildRepairPlan: %v", err)
	}
	if len(plan.groups) != 0 || len(plan.reactivatedAnchorIDs) != 0 {
		t.Fatalf("unexpected structural repair: groups=%v reactivated=%v", plan.groups, plan.reactivatedAnchorIDs)
	}
	if plan.rewrittenAnchorRefs != 1 || !plan.hasChanges() {
		t.Fatalf("stale projection reference was not planned: %+v", plan)
	}
	if plan.originalVersion != 10 || plan.repairedVersion != 11 {
		t.Fatalf("versions: %d -> %d", plan.originalVersion, plan.repairedVersion)
	}
	root, err := decodeJSONObject(plan.raw, "repaired state")
	if err != nil {
		t.Fatalf("decode repaired state: %v", err)
	}
	anchors, err := decodeObjectArray(root["anchors"], "anchors")
	if err != nil || len(anchors) != 1 {
		t.Fatalf("decode repaired anchors: count=%d err=%v", len(anchors), err)
	}
	assertNestedAnchorReference(t, anchors[0]["lastTurnSnapshot"], "anchor-first")
}

func TestBuildRepairPlanRewritesLegacyExecutionTargetRefs(t *testing.T) {
	now := time.Date(2026, 8, 7, 0, 0, 0, 0, time.UTC)
	anchor := testAnchor(
		"anchor-only",
		"2026-08-01T09:00:00Z",
		"2026-08-01T10:00:00Z",
		"desktop.app",
		nil,
		nil,
	)
	anchor["binding"] = map[string]any{
		"TargetRef": map[string]any{
			"local_runtime": map[string]any{
				"version":            "v2",
				"profile_binding_id": "profile-binding-1",
			},
		},
	}
	anchor["bindings"] = map[string]any{
		"image": map[string]any{
			"target_ref": map[string]any{
				"cloud": map[string]any{
					"version":                 "v2",
					"connector_id":            "connector-1",
					"remote_model_catalog_id": "catalog-model-1",
					"provider_model_id":       "provider-model-1",
					"provider":                "provider-1",
				},
			},
		},
		"text": map[string]any{
			"target_ref": map[string]any{
				"local": map[string]any{
					"readinessRef": "readiness-1",
				},
			},
		},
	}
	raw := marshalTestState(t, map[string]any{
		"version":             12,
		"anchors":             []any{anchor},
		"followUps":           []any{},
		"avatarLiveInstances": []any{},
	})

	plan, err := buildRepairPlan(raw, 12, now)
	if err != nil {
		t.Fatalf("buildRepairPlan: %v", err)
	}
	if plan.rewrittenTargetRefs != 2 || !plan.hasChanges() {
		t.Fatalf("legacy target refs were not planned: %+v", plan)
	}
	if plan.originalVersion != 12 || plan.repairedVersion != 13 {
		t.Fatalf("versions: %d -> %d", plan.originalVersion, plan.repairedVersion)
	}
	root, err := decodeJSONObject(plan.raw, "repaired state")
	if err != nil {
		t.Fatalf("decode repaired state: %v", err)
	}
	anchors, err := decodeObjectArray(root["anchors"], "anchors")
	if err != nil || len(anchors) != 1 {
		t.Fatalf("decode repaired anchors: count=%d err=%v", len(anchors), err)
	}
	binding, err := decodeJSONObject(anchors[0]["binding"], "binding")
	if err != nil {
		t.Fatalf("decode binding: %v", err)
	}
	localTarget, err := decodeJSONObject(binding["TargetRef"], "local target")
	if err != nil {
		t.Fatalf("decode local target: %v", err)
	}
	if _, legacy := localTarget["local_runtime"]; legacy {
		t.Fatal("legacy local_runtime target was preserved")
	}
	local, err := decodeJSONObject(localTarget["local"], "canonical local target")
	if err != nil {
		t.Fatalf("decode canonical local target: %v", err)
	}
	if profileBindingID, err := requiredString(local, "profileBindingId"); err != nil || profileBindingID != "profile-binding-1" {
		t.Fatalf("canonical profile binding=%q err=%v", profileBindingID, err)
	}
	bindings, err := decodeJSONObject(anchors[0]["bindings"], "bindings")
	if err != nil {
		t.Fatalf("decode bindings: %v", err)
	}
	imageBinding, err := decodeJSONObject(bindings["image"], "image binding")
	if err != nil {
		t.Fatalf("decode image binding: %v", err)
	}
	cloudTarget, err := decodeJSONObject(imageBinding["target_ref"], "cloud target")
	if err != nil {
		t.Fatalf("decode cloud target: %v", err)
	}
	cloud, err := decodeJSONObject(cloudTarget["cloud"], "canonical cloud target")
	if err != nil {
		t.Fatalf("decode canonical cloud target: %v", err)
	}
	if connectorID, err := requiredString(cloud, "connectorId"); err != nil || connectorID != "connector-1" {
		t.Fatalf("canonical connector=%q err=%v", connectorID, err)
	}
	textBinding, err := decodeJSONObject(bindings["text"], "text binding")
	if err != nil {
		t.Fatalf("decode text binding: %v", err)
	}
	canonicalTarget, err := decodeJSONObject(textBinding["target_ref"], "current target")
	if err != nil {
		t.Fatalf("decode current target: %v", err)
	}
	canonicalLocal, err := decodeJSONObject(canonicalTarget["local"], "current local target")
	if err != nil {
		t.Fatalf("decode current local target: %v", err)
	}
	if readinessRef, err := requiredString(canonicalLocal, "readinessRef"); err != nil || readinessRef != "readiness-1" {
		t.Fatalf("current readiness ref=%q err=%v", readinessRef, err)
	}
}

func TestBuildRepairPlanRemovesRetiredLocalAppIdentityFields(t *testing.T) {
	now := time.Date(2026, 8, 12, 4, 0, 0, 0, time.UTC)
	anchor := testAnchor(
		"anchor-only",
		"2026-08-01T09:00:00Z",
		"2026-08-01T10:00:00Z",
		"desktop.app",
		nil,
		nil,
	)
	anchor["localAppPrincipalId"] = "retired-principal"
	anchor["binding"] = map[string]any{
		"ModelID":          "text.generate",
		"localAppRecordId": "retired-record",
		"futureField":      "preserved",
	}
	raw := marshalTestState(t, map[string]any{
		"version":             20,
		"anchors":             []any{anchor},
		"followUps":           []any{},
		"avatarLiveInstances": []any{},
	})

	plan, err := buildRepairPlan(raw, 20, now)
	if err != nil {
		t.Fatalf("buildRepairPlan: %v", err)
	}
	if plan.removedLegacyIdentityFields != 2 || !plan.hasChanges() {
		t.Fatalf("retired identity fields were not planned: %+v", plan)
	}
	if plan.originalVersion != 20 || plan.repairedVersion != 21 {
		t.Fatalf("versions: %d -> %d", plan.originalVersion, plan.repairedVersion)
	}
	root, err := decodeJSONObject(plan.raw, "repaired state")
	if err != nil {
		t.Fatalf("decode repaired state: %v", err)
	}
	anchors, err := decodeObjectArray(root["anchors"], "anchors")
	if err != nil || len(anchors) != 1 {
		t.Fatalf("decode repaired anchors: count=%d err=%v", len(anchors), err)
	}
	if _, exists := anchors[0]["localAppPrincipalId"]; exists {
		t.Fatal("retired localAppPrincipalId was preserved")
	}
	binding, err := decodeJSONObject(anchors[0]["binding"], "binding")
	if err != nil {
		t.Fatalf("decode binding: %v", err)
	}
	if _, exists := binding["localAppRecordId"]; exists {
		t.Fatal("retired localAppRecordId was preserved")
	}
	if value, err := requiredString(binding, "futureField"); err != nil || value != "preserved" {
		t.Fatalf("future field=%q err=%v", value, err)
	}
}

func TestBuildRepairPlanRejectsUnsupportedLegacyExecutionTargetRef(t *testing.T) {
	anchor := testAnchor(
		"anchor-only",
		"2026-08-01T09:00:00Z",
		"2026-08-01T10:00:00Z",
		"desktop.app",
		nil,
		nil,
	)
	anchor["binding"] = map[string]any{
		"target_ref": map[string]any{
			"local_runtime": map[string]any{
				"profile_binding_id": "profile-binding-1",
				"unexpected":         true,
			},
		},
	}
	raw := marshalTestState(t, map[string]any{
		"version":             1,
		"anchors":             []any{anchor},
		"followUps":           []any{},
		"avatarLiveInstances": []any{},
	})

	_, err := buildRepairPlan(raw, 1, time.Now().UTC())
	if err == nil || !strings.Contains(err.Error(), `unsupported field "unexpected"`) {
		t.Fatalf("unsupported legacy target_ref must fail closed, got %v", err)
	}
}

func TestBuildRepairPlanRejectsConflictingTurnIDContent(t *testing.T) {
	raw := marshalTestState(t, map[string]any{
		"version": 1,
		"anchors": []any{
			testAnchor(
				"anchor-first",
				"2026-07-29T09:00:00Z",
				"2026-07-29T10:00:00Z",
				"desktop.app",
				[]any{testTurn("turn-conflict", 0, "hello", "first reply")},
				nil,
			),
			testAnchor(
				"anchor-later",
				"2026-07-30T09:00:00Z",
				"2026-07-30T10:00:00Z",
				"zhiyu.app",
				[]any{testTurn("turn-conflict", 0, "hello", "different reply")},
				nil,
			),
		},
		"followUps":           []any{},
		"avatarLiveInstances": []any{},
	})
	_, err := buildRepairPlan(raw, 1, time.Now().UTC())
	if err == nil || !strings.Contains(err.Error(), "conflicting content") {
		t.Fatalf("conflicting TurnID content must fail closed, got %v", err)
	}
}

func TestRepairDatabaseApplyReactivatesClosedSingleton(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "runtime.sqlite")
	backupPath := filepath.Join(dir, "before-reactivation.sqlite")
	raw := marshalTestState(t, map[string]any{
		"version": 2,
		"anchors": []any{
			testAnchor(
				"anchor-first",
				"2026-07-29T09:00:00Z",
				"2026-07-29T10:00:00Z",
				"desktop.app",
				[]any{testTurn("turn-1", 0, "hello", "reply")},
				nil,
			),
		},
		"followUps":           []any{},
		"avatarLiveInstances": []any{},
	})
	createRepairTestDatabase(t, dbPath, string(raw))

	dryRun, err := repairDatabase(ctx, repairOptions{
		DBPath: dbPath,
		Now:    time.Date(2026, 7, 31, 8, 30, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("dry-run repairDatabase: %v", err)
	}
	if dryRun.Applied || len(dryRun.DuplicateGroups) != 0 ||
		len(dryRun.ReactivatedAnchorIDs) != 1 || dryRun.ReactivatedAnchorIDs[0] != "anchor-first" {
		t.Fatalf("closed singleton dry-run result: %+v", dryRun)
	}
	assertStoredStateContains(t, dbPath, `"status":2`)

	applied, err := repairDatabase(ctx, repairOptions{
		DBPath:     dbPath,
		BackupPath: backupPath,
		Apply:      true,
		Now:        time.Date(2026, 7, 31, 8, 30, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("apply repairDatabase: %v", err)
	}
	if !applied.Applied || applied.BackupPath != backupPath ||
		len(applied.ReactivatedAnchorIDs) != 1 || applied.ReactivatedAnchorIDs[0] != "anchor-first" {
		t.Fatalf("closed singleton applied result: %+v", applied)
	}
	assertStoredStateContains(t, backupPath, `"status":2`)
	assertStoredStateContains(t, dbPath, `"status":1`)
}

func TestRepairDatabaseApplyBacksUpAndAtomicallyRewritesState(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "runtime.sqlite")
	backupPath := filepath.Join(dir, "before-repair.sqlite")
	raw := marshalTestState(t, map[string]any{
		"version": 2,
		"anchors": []any{
			testAnchor(
				"anchor-first",
				"2026-07-29T09:00:00Z",
				"2026-07-29T10:00:00Z",
				"desktop.app",
				[]any{testTurn("turn-1", 0, "hello", "reply")},
				nil,
			),
			testAnchor(
				"anchor-later",
				"2026-07-30T09:00:00Z",
				"2026-07-30T10:00:00Z",
				"zhiyu.app",
				[]any{testTurn("turn-2", 0, "continue", "continued")},
				nil,
			),
		},
		"followUps": []any{map[string]any{
			"followUpId":           "follow-1",
			"conversationAnchorId": "anchor-later",
		}},
		"avatarLiveInstances": []any{},
	})
	createRepairTestDatabase(t, dbPath, string(raw))

	dryRun, err := repairDatabase(ctx, repairOptions{DBPath: dbPath, Now: time.Date(2026, 7, 31, 9, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatalf("dry-run repairDatabase: %v", err)
	}
	if dryRun.Applied || len(dryRun.DuplicateGroups) != 1 {
		t.Fatalf("dry-run result: %+v", dryRun)
	}
	assertStoredStateContains(t, dbPath, "anchor-later")

	applied, err := repairDatabase(ctx, repairOptions{
		DBPath:     dbPath,
		BackupPath: backupPath,
		Apply:      true,
		Now:        time.Date(2026, 7, 31, 9, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("apply repairDatabase: %v", err)
	}
	if !applied.Applied || applied.BackupPath != backupPath {
		t.Fatalf("applied result: %+v", applied)
	}
	if info, err := os.Stat(backupPath); err != nil || info.Size() == 0 {
		t.Fatalf("backup was not created: info=%v err=%v", info, err)
	}
	assertStoredStateContains(t, backupPath, "anchor-later")
	assertMetadataValue(t, backupPath, conversationAnchorMetaPrefix+"anchor-later", true)

	assertStoredStateDoesNotContain(t, dbPath, `"conversationAnchorId":"anchor-later"`)
	assertMetadataValue(t, dbPath, conversationAnchorMetaPrefix+"anchor-later", false)
	assertMetadataValue(t, dbPath, conversationAnchorMetaPrefix+"anchor-first", true)
}

func TestInstallerPreinstallReportsUninitializedChatStateAsNotApplicable(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "runtime.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open test SQLite: %v", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE runtime_local_agent_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`); err != nil {
		_ = db.Close()
		t.Fatalf("create Runtime meta table: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close test SQLite: %v", err)
	}

	var stdout strings.Builder
	var stderr strings.Builder
	exitCode := run([]string{
		"--db", dbPath,
		"--confirm-runtime-stopped",
		"--apply",
		"--installer-preinstall",
		"--json",
	}, &stdout, &stderr)
	if exitCode != 0 {
		t.Fatalf("installer preinstall exit=%d stderr=%s", exitCode, stderr.String())
	}
	var result struct {
		SchemaVersion int    `json:"schemaVersion"`
		Status        string `json:"status"`
		SkipReason    string `json:"skipReason"`
		BackupPath    string `json:"backupPath"`
	}
	if err := json.Unmarshal([]byte(stdout.String()), &result); err != nil {
		t.Fatalf("decode installer preinstall result: %v\n%s", err, stdout.String())
	}
	if result.SchemaVersion != 1 ||
		result.Status != "not-applicable" ||
		result.SkipReason != "public_chat_state_uninitialized" ||
		result.BackupPath != "" {
		t.Fatalf("installer preinstall result: %+v", result)
	}
	matches, err := filepath.Glob(dbPath + ".pre-local-agent-chat-repair-*.sqlite")
	if err != nil {
		t.Fatalf("glob backup paths: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("not-applicable preinstall created backups: %v", matches)
	}
}

func testAnchor(
	id string,
	createdAt string,
	updatedAt string,
	callerAppID string,
	transcript []any,
	completed map[string]any,
) map[string]any {
	anchor := map[string]any{
		"conversationAnchorId": id,
		"agentId":              "local-agent:user-1:alpha",
		"localAgentRef":        "local-agent:user-1:alpha",
		"ownerUserId":          "user-1",
		"runtimeSourceRef":     "runtime-source:alpha",
		"callerAppId":          callerAppID,
		"subjectUserId":        "user-1",
		"threadId":             "thread-" + id,
		"committedTranscript":  transcript,
		"status":               1,
		"lastTurnId":           "last-" + id,
		"createdAt":            createdAt,
		"updatedAt":            updatedAt,
	}
	if id == "anchor-first" {
		anchor["futureAnchorField"] = map[string]any{"preserved": true}
		anchor["status"] = 2
	}
	if completed != nil {
		anchor["completedTurnSnapshots"] = completed
	}
	return anchor
}

func withProjectionAnchorRefs(anchor map[string]any, anchorID string) map[string]any {
	anchor["lastTurnSnapshot"] = map[string]any{
		"status": "completed",
		"contextSummary": map[string]any{
			"conversation_anchor_id": anchorID,
		},
	}
	if completed, ok := anchor["completedTurnSnapshots"].(map[string]any); ok {
		for _, value := range completed {
			if snapshot, ok := value.(map[string]any); ok {
				snapshot["contextSummary"] = map[string]any{
					"conversation_anchor_id": anchorID,
				}
			}
		}
	}
	return anchor
}

func testTurn(turnID string, sequence int, input string, assistant string) map[string]any {
	return map[string]any{
		"turnId":        turnID,
		"sequence":      sequence,
		"origin":        "user",
		"inputText":     input,
		"assistantText": assistant,
	}
}

func marshalTestState(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal test state: %v", err)
	}
	return raw
}

func assertAnchorReference(t *testing.T, raw json.RawMessage, want string) {
	t.Helper()
	var got string
	if err := decodeJSON(raw, &got, "anchor reference"); err != nil {
		t.Fatalf("decode anchor reference: %v", err)
	}
	if got != want {
		t.Fatalf("anchor reference=%q want=%q", got, want)
	}
}

func assertNestedAnchorReference(t *testing.T, raw json.RawMessage, want string) {
	t.Helper()
	fields, err := decodeJSONObject(raw, "projection snapshot")
	if err != nil {
		t.Fatalf("decode projection snapshot: %v", err)
	}
	contextSummary, err := decodeJSONObject(fields["contextSummary"], "projection context summary")
	if err != nil {
		t.Fatalf("decode projection context summary: %v", err)
	}
	assertAnchorReference(t, contextSummary["conversation_anchor_id"], want)
}

func createRepairTestDatabase(t *testing.T, path string, state string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open test SQLite: %v", err)
	}
	defer func() { _ = db.Close() }()
	if _, err := db.Exec(`
		CREATE TABLE runtime_local_agent_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`); err != nil {
		t.Fatalf("create Runtime meta table: %v", err)
	}
	rows := map[string]string{
		publicChatSurfaceStateKey:                     state,
		publicChatSurfaceVersionKey:                   "2",
		conversationAnchorMetaPrefix + "anchor-first": `{"source":"first"}`,
		conversationAnchorMetaPrefix + "anchor-later": `{"source":"later"}`,
	}
	for key, value := range rows {
		if _, err := db.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)`, key, value); err != nil {
			t.Fatalf("insert test Runtime meta %q: %v", key, err)
		}
	}
}

func assertStoredStateContains(t *testing.T, path string, fragment string) {
	t.Helper()
	raw := storedStateValue(t, path)
	if !strings.Contains(raw, fragment) {
		t.Fatalf("stored state does not contain %q: %s", fragment, raw)
	}
}

func assertStoredStateDoesNotContain(t *testing.T, path string, fragment string) {
	t.Helper()
	raw := storedStateValue(t, path)
	if strings.Contains(raw, fragment) {
		t.Fatalf("stored state unexpectedly contains %q: %s", fragment, raw)
	}
}

func storedStateValue(t *testing.T, path string) string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open SQLite %s: %v", path, err)
	}
	defer func() { _ = db.Close() }()
	var raw string
	if err := db.QueryRow(
		`SELECT value FROM runtime_local_agent_meta WHERE key = ?`,
		publicChatSurfaceStateKey,
	).Scan(&raw); err != nil {
		t.Fatalf("read stored state from %s: %v", path, err)
	}
	return raw
}

func assertMetadataValue(t *testing.T, path string, key string, want bool) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open SQLite %s: %v", path, err)
	}
	defer func() { _ = db.Close() }()
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM runtime_local_agent_meta WHERE key = ?`,
		key,
	).Scan(&count); err != nil {
		t.Fatalf("count metadata %q in %s: %v", key, path, err)
	}
	if got := count == 1; got != want {
		t.Fatalf("metadata %q exists=%t want=%t", key, got, want)
	}
}
