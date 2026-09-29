package auditlog

import (
	"path/filepath"
	"strconv"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func refusalEvent(operation string, at time.Time) *runtimev1.AuditEventRecord {
	return &runtimev1.AuditEventRecord{
		AppId:      "app.untrusted",
		Domain:     "refusal",
		Operation:  operation,
		ReasonCode: runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
		Timestamp:  timestamppb.New(at),
	}
}

func countDomainRecords(t *testing.T, store *Store, domain string) int {
	t.Helper()
	count := 0
	request := &runtimev1.ListAuditEventsRequest{Domain: domain, PageSize: 200}
	for {
		response, err := store.ListEvents(request)
		if err != nil {
			t.Fatal(err)
		}
		count += len(response.GetEvents())
		if response.GetNextPageToken() == "" {
			return count
		}
		request.PageToken = response.GetNextPageToken()
	}
}

func TestRefusalsAreCoalescedPerKindAndCappedPerWindow(t *testing.T) {
	store := New(4096, 16)
	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	store.refusals.now = func() time.Time { return now }

	// A flood of one refusal kind writes one record.
	for attempt := 0; attempt < 50; attempt++ {
		if err := store.AppendRefusal(refusalEvent("flood", now)); err != nil {
			t.Fatal(err)
		}
	}
	if got := listOperations(t, store, "refusal"); len(got) != 1 {
		t.Fatalf("flooded kind wrote %d records", len(got))
	}
	// Distinct kinds are capped per window.
	for index := 0; index < RefusalRecordsPerWindow+25; index++ {
		if err := store.AppendRefusal(refusalEvent("kind-"+strconv.Itoa(index), now)); err != nil {
			t.Fatal(err)
		}
	}
	if got := countDomainRecords(t, store, "refusal"); got != RefusalRecordsPerWindow {
		t.Fatalf("one window wrote %d refusals, cap %d", got, RefusalRecordsPerWindow)
	}

	// The next window reports everything suppressed before it.
	now = now.Add(RefusalWindow)
	if err := store.AppendRefusal(refusalEvent("flood", now)); err != nil {
		t.Fatal(err)
	}
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "refusal", PageSize: 1})
	if err != nil || len(response.GetEvents()) != 1 {
		t.Fatalf("latest refusal = %v err=%v", response, err)
	}
	latest := response.GetEvents()[0]
	// 49 repeats of the flooded kind, plus the 26 distinct kinds past the cap
	// (the flooded kind's first record already used one of the window's slots).
	if latest.GetOperation() != "flood" || latest.GetPayload().GetFields()["suppressed_count"].GetNumberValue() != 49+26 {
		t.Fatalf("suppressed refusals were not reported: %v", latest)
	}
}

func TestRefusalWhoseRecordFailsIsNotCounted(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend, store := openDurableTestStore(t, statePath, 100)
	t.Cleanup(func() { _ = backend.Close() })
	now := time.Now().UTC()
	if _, err := backend.DB().Exec(`CREATE TRIGGER test_block_audit BEFORE INSERT ON runtime_audit_event BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendRefusal(refusalEvent("denied", now)); err == nil {
		t.Fatal("unwritable refusal reported as recorded")
	}
	if _, err := backend.DB().Exec(`DROP TRIGGER test_block_audit`); err != nil {
		t.Fatal(err)
	}
	// The failed admission is released, so the next identical refusal writes.
	if err := store.AppendRefusal(refusalEvent("denied", now)); err != nil {
		t.Fatal(err)
	}
	if got := listOperations(t, store, "refusal"); len(got) != 1 {
		t.Fatalf("refusal after a failed record = %v", got)
	}
}
