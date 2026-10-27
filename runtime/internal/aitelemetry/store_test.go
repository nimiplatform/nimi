package aitelemetry

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func testOwner(t *testing.T) (*Store, *runtimepersistence.Backend, *time.Time) {
	t.Helper()
	backend, err := runtimepersistence.Open(slog.New(slog.NewTextHandler(io.Discard, nil)), filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	now := time.Date(2026, 10, 23, 0, 0, 0, 0, time.UTC)
	store := openWithClock(backend, slog.New(slog.NewTextHandler(io.Discard, nil)), func() time.Time { return now })
	for _, source := range sourceNames() {
		store.SetSourceCoverage(source, true, true)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, backend, &now
}

func testRecord(id, account string, at time.Time) Record {
	return Record{Facts: Facts{AccountID: account, OperationID: "job-" + id, Source: Source{Kind: "app", ID: "app.test", Label: "Test App", ParentID: "job-" + id, ParentKind: "scenario-job"}, Capability: "text.generate", Models: []*runtimev1.DesktopAIExecutionModel{{ModelId: "model", DisplayName: "Model", ProviderId: "provider"}}, Route: runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_CLOUD, Price: Price{Unit: "token", Input: "2", Output: "8", Currency: "USD"}}, ID: id, Revision: 1, StartedAt: at, ObservedAt: at}
}

func flushOwner(t *testing.T, s *Store) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Flush(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestCumulativeRevisionsAndHalfOpenAccountRead(t *testing.T) {
	s, _, now := testOwner(t)
	from := *now
	*now = now.Add(time.Second)
	record := testRecord("one", "account-a", *now)
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	record.Revision = 2
	record.Usage = &runtimev1.UsageStats{InputTokens: 50}
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	old := record
	*now = now.Add(time.Second)
	record.Revision = 3
	record.Usage = &runtimev1.UsageStats{InputTokens: 100, OutputTokens: 20}
	record.TerminalAt = *now
	record.ObservedAt = *now
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	if err := s.Record(old); err != nil {
		t.Fatal(err)
	}
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	other := testRecord("two", "account-b", record.StartedAt)
	if err := s.Record(other); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	flushOwner(t, s)
	summary, err := s.Summary(context.Background(), "account-a", from, *now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.AttemptCount != 1 || summary.Totals.InputTokens != 100 || summary.Totals.OutputTokens != 20 || !summary.TimeComplete || !summary.SourceComplete || !summary.QuantityComplete {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	if len(summary.Estimates) != 1 || summary.Estimates[0].EstimatedAmount != "0.00036" {
		t.Fatalf("incorrect estimate: %+v", summary.Estimates)
	}
	before, err := s.Summary(context.Background(), "account-a", from, record.StartedAt)
	if err != nil {
		t.Fatal(err)
	}
	if before.Totals.AttemptCount != 0 {
		t.Fatal("exclusive end counted an attempt")
	}
	if got := s.Snapshot("account-a", 50); got.KnownActiveAttemptCount != 0 {
		t.Fatal("old revision revived a terminal attempt")
	}
}

func TestCrashRetainsCountsAndCoverageUncertainty(t *testing.T) {
	s, backend, now := testOwner(t)
	from := *now
	*now = now.Add(time.Second)
	record := testRecord("crash", "account-a", *now)
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	flushOwner(t, s)
	*now = now.Add(time.Minute)
	recovered := openWithClock(backend, s.logger, func() time.Time { return *now })
	defer func() { _ = recovered.Close() }()
	for _, source := range sourceNames() {
		recovered.SetSourceCoverage(source, true, true)
	}
	*now = now.Add(time.Minute)
	summary, err := recovered.Summary(context.Background(), "account-a", from, *now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.AttemptCount != 1 || summary.TimeComplete || summary.QuantityComplete {
		t.Fatalf("crash coverage was lost: %+v", summary)
	}
	if got := recovered.Snapshot("account-a", 50); got.KnownActiveAttemptCount != 0 {
		t.Fatal("recovery replayed or invented execution")
	}
}

type failingBackend struct {
	Backend
	fail bool
}

func (b *failingBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if b.fail {
		return errors.New("storage unavailable")
	}
	return b.Backend.WriteTx(ctx, fn)
}

func TestFailedAccountingAndGapWriteCannotBecomeCompleteAfterCrash(t *testing.T) {
	s, backend, now := testOwner(t)
	from := *now
	failure := &failingBackend{Backend: backend, fail: true}
	s.backend = failure
	*now = now.Add(time.Second)
	if err := s.Record(testRecord("lost", "account-a", *now)); err != nil {
		t.Fatal(err)
	}
	if err := s.Flush(context.Background()); err == nil {
		t.Fatal("expected asynchronous persistence failure")
	}
	*now = now.Add(time.Minute)
	recovered := openWithClock(backend, s.logger, func() time.Time { return *now })
	defer func() { _ = recovered.Close() }()
	for _, source := range sourceNames() {
		recovered.SetSourceCoverage(source, true, true)
	}
	*now = now.Add(time.Minute)
	summary, err := recovered.Summary(context.Background(), "account-a", from, *now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.TimeComplete {
		t.Fatal("failed writes followed by a crash were reported complete")
	}
}

func TestTerminalRetentionRejectsOldRevisionAndUnknownUnitsStayUnpriced(t *testing.T) {
	s, _, now := testOwner(t)
	*now = now.Add(time.Second)
	record := testRecord("expiry", "account-a", *now)
	record.Price.Unit = "second"
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	record.Revision++
	record.TerminalAt = *now
	record.Usage = &runtimev1.UsageStats{ComputeMs: 120000}
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Minute)
	flushOwner(t, s)
	summary, err := s.Summary(context.Background(), "account-a", record.StartedAt, *now)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Totals.UnpricedAttemptCount != 1 || len(summary.Estimates) != 0 {
		t.Fatal("inference time was treated as media billing quantity")
	}
	*now = now.Add(Retention)
	newRecord := testRecord("new", "account-a", *now)
	if err := s.Record(newRecord); err != nil {
		t.Fatal(err)
	}
	record.Revision++
	if err := s.Record(record); err != nil {
		t.Fatal(err)
	}
	flushOwner(t, s)
	var count int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_ai_usage_attempt WHERE attempt_id='expiry'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("expired attempt was recreated")
	}
}

func TestSnapshotMissingParentAndSourceNeverClaimsExactWorkCount(t *testing.T) {
	s, _, now := testOwner(t)
	*now = now.Add(time.Second)
	record := testRecord("unassociated", "account-a", *now)
	record.Source.ParentID = ""
	s.Begin(record.Facts)
	snapshot := s.Snapshot("account-a", 50)
	if snapshot.WorkCountKnown || snapshot.KnownActiveAttemptCount != 1 || len(snapshot.Executions) != 1 {
		t.Fatalf("bad unassociated projection: %+v", snapshot)
	}
	s.SetSourceCoverage("realtime", false, false)
	if s.Snapshot("account-b", 50).WorkCountKnown {
		t.Fatal("empty account falsely proved source completeness")
	}
}

func TestObservationSchemaFailureIsOptionalAndPreservesExistingData(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "existing-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES ('unrelated-user-data','preserved')`); err != nil {
			return err
		}
		// An incompatible optional namespace must not trigger ALTER, migration,
		// deletion, or make the already-admitted Runtime backend unusable.
		_, err := tx.Exec(`CREATE TABLE runtime_ai_usage_attempt(unrecognized INTEGER)`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	owner := Open(backend, logger)
	defer func() { _ = owner.Close() }()
	if owner.initialized {
		t.Fatal("incompatible observation schema was silently accepted")
	}
	var value string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key='unrelated-user-data'`).Scan(&value); err != nil || value != "preserved" {
		t.Fatalf("existing user data changed: %q %v", value, err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES ('still-usable','yes')`)
		return err
	}); err != nil {
		t.Fatalf("optional schema failure closed the Runtime backend: %v", err)
	}
}
