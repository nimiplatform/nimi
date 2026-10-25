package account

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func accountDiagnosticRowsForTest(t *testing.T, output []byte) []map[string]any {
	t.Helper()
	var rows []map[string]any
	for _, line := range bytes.Split(bytes.TrimSpace(output), []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal(line, &row); err != nil {
			t.Fatal("diagnostic output is not structured JSON")
		}
		rows = append(rows, row)
	}
	return rows
}

func TestAccountAuthorizationDiagnosticsContainOnlySafeTransitionFacts(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	service := revisionAccountForTest(&now)
	installRevisionAccountForTest(t, service, "account-not-for-diagnostics", "realm-not-for-diagnostics", now.Add(time.Hour))
	before := requireAuthorizationRevisionForTest(t, service.currentSnapshotLocked())
	var output bytes.Buffer
	service.logger = slog.New(slog.NewJSONHandler(&output, nil))
	service.logAccountAuthorizationTransition(accountRefreshScheduled, service.state, before, true)
	service.clearAuthenticatedRuntimeIdentityLocked()
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
	service.logAccountAuthorizationTransition(accountRefreshRealmUnauthorized, runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED, before, false)
	rows := accountDiagnosticRowsForTest(t, output.Bytes())
	if len(rows) != 2 || rows[0]["cause"] != "scheduled" || rows[0]["authorization_revision_changed"] != false || rows[1]["authorization_revision_changed"] != true {
		t.Fatal("diagnostic cause or continuity-change facts are incorrect")
	}
	allowed := map[string]bool{"time": true, "level": true, "msg": true, "cause": true, "from_state": true, "to_state": true, "authorization_revision_changed": true, "accepted": true}
	for _, row := range rows {
		for key := range row {
			if !allowed[key] {
				t.Fatalf("unexpected diagnostic field: %s", key)
			}
		}
	}
	if bytes.Contains(output.Bytes(), []byte(before)) || bytes.Contains(output.Bytes(), []byte("account-not-for-diagnostics")) || bytes.Contains(output.Bytes(), []byte("realm-not-for-diagnostics")) {
		t.Fatal("diagnostics exposed identity or revision values")
	}
}

func TestAccountRefreshSchedulingDiagnosticsReflectExistingDelay(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	service := revisionAccountForTest(&now)
	installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(5*time.Minute))
	var output bytes.Buffer
	service.logger = slog.New(slog.NewJSONHandler(&output, nil))
	service.rebuildRefreshTimerLocked()
	defer service.refreshTimer.Stop()
	rows := accountDiagnosticRowsForTest(t, output.Bytes())
	if len(rows) != 1 || rows[0]["cause"] != "scheduled" || rows[0]["delay_ms"] != float64((5*time.Minute-proactiveRefreshLead).Milliseconds()) {
		t.Fatal("proactive refresh diagnostic changed or misreported the existing delay")
	}
	service.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REFRESH_PENDING
	service.stateReason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_REFRESH_RETRY_DEFERRED
	service.refreshRetryAttempt = 3
	service.rebuildRefreshTimerLocked()
	defer service.refreshTimer.Stop()
	rows = accountDiagnosticRowsForTest(t, output.Bytes())
	if len(rows) != 2 || rows[1]["cause"] != "scheduled-retry" || rows[1]["delay_ms"] != float64(8000) {
		t.Fatal("deferred refresh diagnostic changed or misreported the existing backoff")
	}
}

func TestAccountRefreshTransactionRetainsDiagnosticCauseOnCustodyFailure(t *testing.T) {
	now := time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC)
	service := revisionAccountForTest(&now)
	installRevisionAccountForTest(t, service, "account-a", "realm-a", now.Add(20*time.Second))
	var output bytes.Buffer
	service.logger = slog.New(slog.NewJSONHandler(&output, nil))
	service.custody = unavailableCustody{}
	result, err := service.refreshAccountSessionForRejectedToken(context.Background(), false, "", accountRefreshScheduled)
	if err != nil || result == nil || result.accepted || result.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_UNAVAILABLE {
		t.Fatal("failed custody did not remain unavailable")
	}
	found := false
	for _, row := range accountDiagnosticRowsForTest(t, output.Bytes()) {
		if row["msg"] == "runtime account authorization transition" {
			found = true
			if row["cause"] != "scheduled" || row["accepted"] != false || row["authorization_revision_changed"] != true {
				t.Fatal("refresh transaction lost its safe cause or failure outcome")
			}
		}
	}
	if !found {
		t.Fatal("actual refresh attempt emitted no transition diagnostic")
	}
}
