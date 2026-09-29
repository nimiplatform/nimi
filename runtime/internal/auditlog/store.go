package auditlog

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditredaction"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultMaxEvents = 20000
	defaultMaxUsage  = 50000

	// MaxRecordBytes caps one encoded audit record. A payload that would exceed
	// it is replaced by its size and digest, so one owner cannot exhaust the
	// retained evidence of every other owner.
	MaxRecordBytes = 32 * 1024
	// MaxRetainedBytes caps the encoded bytes retained across all records in
	// addition to the event-count bound. The oldest records are evicted first.
	MaxRetainedBytes = 64 * 1024 * 1024
)

// ErrUnrecorded marks every failure to durably commit an audit record. Owners
// use it to fail a sensitive mutation before its effect, or to surface an
// unrecorded but already committed effect without claiming it did not happen.
var ErrUnrecorded = errors.New("audit record was not durably recorded")

// Backend is the Runtime persistence owner the audit plane writes into. The
// production value is the shared Runtime SQLite backend, so owners whose
// business rows live in the same backend commit their audit record in the
// same transaction.
type Backend interface {
	DB() *sql.DB
	WriteTx(context.Context, func(*sql.Tx) error) error
}

// UsageInput is a write contract for runtime usage accounting.
type UsageInput struct {
	Timestamp     time.Time
	AppID         string
	SubjectUserID string
	CallerKind    runtimev1.CallerKind
	CallerID      string
	Capability    string
	ModelID       string
	Success       bool
	Usage         *runtimev1.UsageStats
	QueueWaitMs   int64
}

// @nimi-authority: definition.nimi.runtime.rpc-foundations.audit-plane
// @nimi-authority: rule.nimi.runtime.rpc-foundations.r003
// Store is the Runtime audit plane. Audit records persist in the Runtime
// persistence backend with a count and byte bound; usage accounting is a
// non-security aggregate kept in a bounded in-process window.
type Store struct {
	backend   Backend
	openErr   error
	logger    *slog.Logger
	maxEvents int
	maxBytes  int64

	refusals refusalLimiter

	usageMu  sync.RWMutex
	maxUsage int
	usage    []UsageInput
}

// Open binds the audit plane to the Runtime persistence backend and applies
// the current retention bound to the records kept by previous processes.
func Open(backend Backend, logger *slog.Logger, maxEvents int, maxUsage int) (*Store, error) {
	if backend == nil {
		return nil, errors.New("audit store: Runtime persistence backend is required")
	}
	store := newStore(backend, logger, maxEvents, maxUsage)
	err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE runtime_audit_retention SET retained_bytes = (SELECT COALESCE(SUM(record_bytes), 0) FROM runtime_audit_event) WHERE singleton = 1`); err != nil {
			return fmt.Errorf("measure retained audit records: %w", err)
		}
		return store.enforceRetentionTx(context.Background(), tx, 0)
	})
	if err != nil {
		return nil, fmt.Errorf("audit store: apply retention bound: %w", err)
	}
	return store, nil
}

// New returns a store backed by a private in-process database. It serves
// unit tests and offline tools that construct Runtime owners outside the
// daemon and retains nothing across processes; Runtime composition uses Open.
func New(maxEvents int, maxUsage int) *Store {
	backend, err := openEphemeralBackend()
	store := newStore(backend, nil, maxEvents, maxUsage)
	if err != nil {
		store.backend = nil
		store.openErr = err
	}
	return store
}

func newStore(backend Backend, logger *slog.Logger, maxEvents int, maxUsage int) *Store {
	if maxEvents <= 0 {
		maxEvents = defaultMaxEvents
	}
	if maxUsage <= 0 {
		maxUsage = defaultMaxUsage
	}
	return &Store{
		backend:   backend,
		logger:    logger,
		maxEvents: maxEvents,
		maxBytes:  MaxRetainedBytes,
		refusals:  refusalLimiter{now: time.Now, kinds: make(map[string]*refusalKind)},
		maxUsage:  maxUsage,
		usage:     make([]UsageInput, 0, maxUsage),
	}
}

// PersistsIn reports whether the store writes into exactly this backend, so
// an owner may commit its audit record inside its own business transaction.
func (s *Store) PersistsIn(backend Backend) bool {
	if s == nil || s.openErr != nil || s.backend == nil || backend == nil {
		return false
	}
	return sameBackend(s.backend, backend)
}

func sameBackend(left Backend, right Backend) (same bool) {
	defer func() {
		if recover() != nil {
			same = false
		}
	}()
	return left == right
}

func (s *Store) writer() (Backend, error) {
	if s == nil {
		return nil, errors.New("audit store is unavailable")
	}
	if s.openErr != nil {
		return nil, fmt.Errorf("audit store is unavailable: %w", s.openErr)
	}
	if s.backend == nil {
		return nil, errors.New("audit store is unavailable")
	}
	return s.backend, nil
}

func unrecorded(err error) error {
	return fmt.Errorf("%w: %w", ErrUnrecorded, err)
}

// AppendEventChecked is the fail-closed write contract. It returns only after
// the record is durably committed, or an error wrapping ErrUnrecorded.
func (s *Store) AppendEventChecked(event *runtimev1.AuditEventRecord) error {
	if event == nil || event.GetTimestamp() == nil {
		return unrecorded(errors.New("audit event and timestamp are required"))
	}
	if err := event.GetTimestamp().CheckValid(); err != nil {
		return unrecorded(fmt.Errorf("audit event timestamp: %w", err))
	}
	return s.append(event)
}

// AppendEvent is the best-effort write used by emitters whose owner outcome
// does not depend on the record. A failed write is logged, never hidden.
func (s *Store) AppendEvent(event *runtimev1.AuditEventRecord) {
	if s == nil || event == nil {
		return
	}
	if err := s.append(event); err != nil {
		s.ReportUnrecorded(event.GetDomain(), event.GetOperation(), err)
	}
}

// AppendEventTx records event inside the caller's transaction so the record
// and the owner's business commit succeed or fail together. tx must belong to
// the backend this store persists in (see PersistsIn).
func (s *Store) AppendEventTx(ctx context.Context, tx *sql.Tx, event *runtimev1.AuditEventRecord) error {
	if _, err := s.writer(); err != nil {
		return unrecorded(err)
	}
	if tx == nil {
		return unrecorded(errors.New("audit transaction is required"))
	}
	if ctx == nil {
		ctx = context.Background()
	}
	record, err := prepareRecord(event)
	if err != nil {
		return unrecorded(err)
	}
	if err := s.insertTx(ctx, tx, record); err != nil {
		return unrecorded(err)
	}
	return nil
}

// CommitRecorded runs commit inside the transaction that records event, for
// an owner effect that lives outside the audit backend. An audit write
// failure prevents the effect; a failed effect leaves no record; the record
// commits only after the effect succeeded. commit runs on the backend's
// serialized writer and must not use the audit backend itself.
//
// effectCommitted reports whether commit succeeded. When it is true and err is
// non-nil, only the final audit commit failed (err wraps ErrUnrecorded): the
// owner must report its committed effect truthfully and surface the error.
func (s *Store) CommitRecorded(event *runtimev1.AuditEventRecord, commit func() error) (effectCommitted bool, err error) {
	backend, err := s.writer()
	if err != nil {
		return false, unrecorded(err)
	}
	if commit == nil {
		return false, errors.New("audit-recorded commit is required")
	}
	record, err := prepareRecord(event)
	if err != nil {
		return false, unrecorded(err)
	}
	var effectErr error
	effectDone := false
	// A non-cancelable context keeps the caller waiting for the writer's real
	// outcome, so a committed effect is never reported as not having happened.
	ctx := context.Background()
	txErr := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if err := s.insertTx(ctx, tx, record); err != nil {
			return err
		}
		if effectErr = commit(); effectErr != nil {
			return effectErr
		}
		effectDone = true
		return nil
	})
	switch {
	case txErr == nil:
		return true, nil
	case effectDone:
		return true, unrecorded(txErr)
	case effectErr != nil:
		return false, effectErr
	default:
		return false, unrecorded(txErr)
	}
}

func (s *Store) append(event *runtimev1.AuditEventRecord) error {
	backend, err := s.writer()
	if err != nil {
		return unrecorded(err)
	}
	record, err := prepareRecord(event)
	if err != nil {
		return unrecorded(err)
	}
	// Wait for the writer's real outcome: a canceled wait could report a
	// record as missing after the writer committed it.
	ctx := context.Background()
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		return s.insertTx(ctx, tx, record)
	}); err != nil {
		return unrecorded(err)
	}
	return nil
}

// ReportUnrecorded surfaces, through the store's owner logger, a result whose
// record could not be written. The owner's result itself is unchanged.
func (s *Store) ReportUnrecorded(domain string, operation string, err error) {
	s.log().Error("runtime audit record was not recorded",
		"domain", domain,
		"operation", operation,
		"audit_disposition", "unrecorded",
		"error", err,
	)
}

func (s *Store) log() *slog.Logger {
	if s != nil && s.logger != nil {
		return s.logger
	}
	return slog.Default()
}

type preparedRecord struct {
	event   *runtimev1.AuditEventRecord
	encoded []byte
	seconds int64
	nanos   int64
}

// prepareRecord applies defaults, redaction and the record size bound before
// anything is written.
func prepareRecord(event *runtimev1.AuditEventRecord) (preparedRecord, error) {
	record := cloneAuditEvent(event)
	if record == nil {
		return preparedRecord{}, errors.New("audit event is required")
	}
	if record.GetAuditId() == "" {
		record.AuditId = ulid.Make().String()
	}
	if record.GetTimestamp() == nil {
		record.Timestamp = timestamppb.New(time.Now().UTC())
	}
	if record.GetTraceId() == "" {
		record.TraceId = ulid.Make().String()
	}
	// K-AUDIT-017: mask sensitive fields in payload before storage.
	if record.Payload != nil {
		maskSensitiveFields(record.Payload.GetFields())
	}
	encoded, err := marshalRecord(record)
	if err != nil {
		return preparedRecord{}, err
	}
	if len(encoded) > MaxRecordBytes && record.Payload != nil {
		payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(record.Payload)
		if err != nil {
			return preparedRecord{}, fmt.Errorf("encode oversized audit payload: %w", err)
		}
		digest := sha256.Sum256(payload)
		record.Payload = &structpb.Struct{Fields: map[string]*structpb.Value{
			"payload_omitted": structpb.NewStringValue("record_size_limit"),
			"payload_bytes":   structpb.NewNumberValue(float64(len(payload))),
			"payload_sha256":  structpb.NewStringValue("sha256:" + hex.EncodeToString(digest[:])),
		}}
		if encoded, err = marshalRecord(record); err != nil {
			return preparedRecord{}, err
		}
	}
	if len(encoded) > MaxRecordBytes {
		return preparedRecord{}, fmt.Errorf("audit record exceeds %d bytes", MaxRecordBytes)
	}
	timestamp := record.GetTimestamp().AsTime().UTC()
	return preparedRecord{
		event:   record,
		encoded: encoded,
		seconds: timestamp.Unix(),
		nanos:   int64(timestamp.Nanosecond()),
	}, nil
}

func marshalRecord(record *runtimev1.AuditEventRecord) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("encode audit record: %w", err)
	}
	return encoded, nil
}

func (s *Store) insertTx(ctx context.Context, tx *sql.Tx, record preparedRecord) error {
	event := record.event
	if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_audit_event(
		audit_id, timestamp_seconds, timestamp_nanos, app_id, subject_user_id, domain, operation,
		reason_code, caller_kind, caller_id, trace_id, request_id, record_bytes, record
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.GetAuditId(), record.seconds, record.nanos, event.GetAppId(), event.GetSubjectUserId(),
		event.GetDomain(), event.GetOperation(), int64(event.GetReasonCode()), int64(event.GetCallerKind()),
		event.GetCallerId(), event.GetTraceId(), event.GetRequestId(), len(record.encoded), record.encoded,
	); err != nil {
		return fmt.Errorf("insert audit record: %w", err)
	}
	return s.enforceRetentionTx(ctx, tx, int64(len(record.encoded)))
}

// enforceRetentionTx keeps at most maxEvents records and at most maxBytes of
// encoded records, evicting the oldest insertions first, inside the same
// transaction as the insert that grew the store.
func (s *Store) enforceRetentionTx(ctx context.Context, tx *sql.Tx, added int64) error {
	var retained int64
	if err := tx.QueryRowContext(ctx, `SELECT retained_bytes FROM runtime_audit_retention WHERE singleton = 1`).Scan(&retained); err != nil {
		return fmt.Errorf("read audit retention: %w", err)
	}
	retained += added
	var newest sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT MAX(sequence) FROM runtime_audit_event`).Scan(&newest); err != nil {
		return fmt.Errorf("read newest audit record: %w", err)
	}
	if cutoff := newest.Int64 - int64(s.maxEvents); newest.Valid && cutoff > 0 {
		evicted, err := evictThroughTx(ctx, tx, cutoff)
		if err != nil {
			return err
		}
		retained -= evicted
	}
	if retained > s.maxBytes {
		rows, err := tx.QueryContext(ctx, `SELECT sequence, record_bytes FROM runtime_audit_event ORDER BY sequence ASC`)
		if err != nil {
			return fmt.Errorf("read audit retention order: %w", err)
		}
		var cutoff, freed int64
		for retained-freed > s.maxBytes && rows.Next() {
			var sequence, size int64
			if err := rows.Scan(&sequence, &size); err != nil {
				_ = rows.Close()
				return fmt.Errorf("read audit retention order: %w", err)
			}
			cutoff = sequence
			freed += size
		}
		err = errors.Join(rows.Err(), rows.Close())
		if err != nil {
			return fmt.Errorf("read audit retention order: %w", err)
		}
		if cutoff > 0 {
			evicted, err := evictThroughTx(ctx, tx, cutoff)
			if err != nil {
				return err
			}
			retained -= evicted
		}
	}
	if retained < 0 {
		retained = 0
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_audit_retention SET retained_bytes = ? WHERE singleton = 1`, retained); err != nil {
		return fmt.Errorf("update audit retention: %w", err)
	}
	return nil
}

func evictThroughTx(ctx context.Context, tx *sql.Tx, sequence int64) (int64, error) {
	var evicted sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT SUM(record_bytes) FROM runtime_audit_event WHERE sequence <= ?`, sequence).Scan(&evicted); err != nil {
		return 0, fmt.Errorf("measure evicted audit records: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_audit_event WHERE sequence <= ?`, sequence); err != nil {
		return 0, fmt.Errorf("evict audit records: %w", err)
	}
	return evicted.Int64, nil
}

func (s *Store) RecordUsage(input UsageInput) {
	if s == nil || strings.TrimSpace(input.Capability) == "" {
		return
	}
	ts := input.Timestamp.UTC()
	if ts.IsZero() {
		ts = time.Now().UTC()
	}

	item := UsageInput{
		Timestamp:     ts,
		AppID:         strings.TrimSpace(input.AppID),
		SubjectUserID: strings.TrimSpace(input.SubjectUserID),
		CallerKind:    input.CallerKind,
		CallerID:      strings.TrimSpace(input.CallerID),
		Capability:    strings.TrimSpace(input.Capability),
		ModelID:       strings.TrimSpace(input.ModelID),
		Success:       input.Success,
		Usage:         cloneUsage(input.Usage),
		QueueWaitMs:   input.QueueWaitMs,
	}

	s.usageMu.Lock()
	if len(s.usage) == s.maxUsage {
		copy(s.usage, s.usage[1:])
		s.usage[len(s.usage)-1] = item
	} else {
		s.usage = append(s.usage, item)
	}
	s.usageMu.Unlock()
}

// eventQuery is one bounded, filter-bound page over the retained records.
type eventQuery struct {
	where []string
	args  []any
}

func (q *eventQuery) equal(column string, value any) {
	q.where = append(q.where, column+" = ?")
	q.args = append(q.args, value)
}

func (q *eventQuery) timeBounds(from *timestamppb.Timestamp, to *timestamppb.Timestamp) {
	if from != nil {
		at := from.AsTime().UTC()
		q.where = append(q.where, "(timestamp_seconds, timestamp_nanos) >= (?, ?)")
		q.args = append(q.args, at.Unix(), int64(at.Nanosecond()))
	}
	if to != nil {
		at := to.AsTime().UTC()
		q.where = append(q.where, "(timestamp_seconds, timestamp_nanos) <= (?, ?)")
		q.args = append(q.args, at.Unix(), int64(at.Nanosecond()))
	}
}

func (q *eventQuery) clause() string {
	if len(q.where) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(q.where, " AND ")
}

const eventOrder = " ORDER BY timestamp_seconds DESC, timestamp_nanos DESC, audit_id DESC, sequence DESC"

// page reads one page of columns starting at the owner-issued offset. An
// offset beyond the filtered set restarts at the first page, as before.
func (s *Store) page(query eventQuery, columns string, start int, pageSize int, scan func(*sql.Rows) error) (int, bool, error) {
	if s == nil || s.openErr != nil || s.backend == nil {
		return 0, false, auditStoreUnavailable(errors.New("audit store is unavailable"))
	}
	db := s.backend.DB()
	if start > 0 {
		var total int
		if err := db.QueryRow(`SELECT COUNT(*) FROM runtime_audit_event`+query.clause(), query.args...).Scan(&total); err != nil {
			return 0, false, auditStoreUnavailable(err)
		}
		if start > total {
			start = 0
		}
	}
	args := append(append([]any(nil), query.args...), pageSize+1, start)
	rows, err := db.Query(`SELECT `+columns+` FROM runtime_audit_event`+query.clause()+eventOrder+` LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return 0, false, auditStoreUnavailable(err)
	}
	count := 0
	hasMore := false
	for rows.Next() {
		if count == pageSize {
			hasMore = true
			break
		}
		if err := scan(rows); err != nil {
			_ = rows.Close()
			return 0, false, auditStoreUnavailable(err)
		}
		count++
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return 0, false, auditStoreUnavailable(err)
	}
	return start + count, hasMore, nil
}

// storeUnavailableError is the typed read failure of the canonical store. The
// public status carries no storage detail; the cause stays inspectable.
type storeUnavailableError struct{ cause error }

func (e *storeUnavailableError) Error() string { return "canonical audit store unavailable" }
func (e *storeUnavailableError) Unwrap() error { return e.cause }
func (e *storeUnavailableError) GRPCStatus() *status.Status {
	return status.New(codes.Unavailable, "canonical audit store unavailable")
}

func auditStoreUnavailable(cause error) error {
	return &storeUnavailableError{cause: cause}
}

func boundedPageSize(requested int32, maximum int) int {
	pageSize := int(requested)
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > maximum {
		pageSize = maximum
	}
	return pageSize
}

func (s *Store) ListEvents(req *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	filterDigest := eventFilterDigest(req)
	start, err := parsePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	var query eventQuery
	if req.GetAppId() != "" {
		query.equal("app_id", req.GetAppId())
	}
	if req.GetSubjectUserId() != "" {
		query.equal("subject_user_id", req.GetSubjectUserId())
	}
	if req.GetDomain() != "" {
		query.equal("domain", req.GetDomain())
	}
	if req.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		query.equal("reason_code", int64(req.GetReasonCode()))
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED {
		query.equal("caller_kind", int64(req.GetCallerKind()))
	}
	if req.GetCallerId() != "" {
		query.equal("caller_id", req.GetCallerId())
	}
	query.timeBounds(req.GetFromTime(), req.GetToTime())

	events := make([]*runtimev1.AuditEventRecord, 0)
	end, hasMore, err := s.page(query, "record", start, boundedPageSize(req.GetPageSize(), 200), func(rows *sql.Rows) error {
		var encoded []byte
		if err := rows.Scan(&encoded); err != nil {
			return err
		}
		event := &runtimev1.AuditEventRecord{}
		if err := proto.Unmarshal(encoded, event); err != nil {
			return fmt.Errorf("decode audit record: %w", err)
		}
		events = append(events, event)
		return nil
	})
	if err != nil {
		return nil, err
	}
	nextToken := ""
	if hasMore {
		nextToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}
	return &runtimev1.ListAuditEventsResponse{Events: events, NextPageToken: nextToken}, nil
}

// ListDesktopEvents applies the K-AUDIT-024 filter set and projects the exact
// Desktop-safe wire shape before any event leaves the canonical audit store.
func (s *Store) ListDesktopEvents(req *runtimev1.ListDesktopAuditEventsRequest) (*runtimev1.ListDesktopAuditEventsResponse, error) {
	filterDigest := desktopEventFilterDigest(req)
	start, err := parsePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return &runtimev1.ListDesktopAuditEventsResponse{}, nil
	}
	var query eventQuery
	for _, filter := range []struct {
		column string
		value  string
	}{
		{"trace_id", req.GetTraceId()},
		{"request_id", req.GetRequestId()},
		{"app_id", req.GetAppId()},
		{"domain", req.GetDomain()},
		{"operation", req.GetOperation()},
	} {
		if filter.value != "" {
			query.equal(filter.column, filter.value)
		}
	}
	if req.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		query.equal("reason_code", int64(req.GetReasonCode()))
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED {
		query.equal("caller_kind", int64(req.GetCallerKind()))
	}
	query.timeBounds(req.GetFromTime(), req.GetToTime())

	events := make([]*runtimev1.DesktopAuditEventProjection, 0)
	end, hasMore, err := s.page(query, "audit_id, request_id, app_id, domain, operation, reason_code, trace_id, timestamp_seconds, timestamp_nanos, caller_kind", start, boundedPageSize(req.GetPageSize(), 100), func(rows *sql.Rows) error {
		var projection runtimev1.DesktopAuditEventProjection
		var reason, callerKind, seconds, nanos int64
		if err := rows.Scan(&projection.AuditId, &projection.RequestId, &projection.AppId, &projection.Domain, &projection.Operation, &reason, &projection.TraceId, &seconds, &nanos, &callerKind); err != nil {
			return err
		}
		projection.ReasonCode = runtimev1.ReasonCode(reason)
		projection.CallerKind = runtimev1.CallerKind(callerKind)
		projection.Timestamp = timestamppb.New(time.Unix(seconds, nanos).UTC())
		events = append(events, &projection)
		return nil
	})
	if err != nil {
		return nil, err
	}
	nextToken := ""
	if hasMore {
		nextToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}
	return &runtimev1.ListDesktopAuditEventsResponse{Events: events, NextPageToken: nextToken}, nil
}

func (s *Store) ListUsage(req *runtimev1.ListUsageStatsRequest) (*runtimev1.ListUsageStatsResponse, error) {
	window := normalizeWindow(req.GetWindow())
	filterDigest := usageFilterDigest(req, window)
	type usageKey struct {
		AppID         string
		SubjectUserID string
		CallerKind    runtimev1.CallerKind
		CallerID      string
		Capability    string
		ModelID       string
		Window        runtimev1.UsageWindow
		BucketStart   time.Time
	}

	agg := make(map[usageKey]*runtimev1.UsageStatRecord)
	s.usageMu.RLock()
	for _, sample := range s.usage {
		if !matchesUsageFilter(sample, req) {
			continue
		}
		bucket := truncateByWindow(sample.Timestamp, window)
		key := usageKey{
			AppID:         sample.AppID,
			SubjectUserID: sample.SubjectUserID,
			CallerKind:    sample.CallerKind,
			CallerID:      sample.CallerID,
			Capability:    sample.Capability,
			ModelID:       sample.ModelID,
			Window:        window,
			BucketStart:   bucket,
		}
		item, exists := agg[key]
		if !exists {
			item = &runtimev1.UsageStatRecord{
				AppId:         sample.AppID,
				SubjectUserId: sample.SubjectUserID,
				CallerKind:    sample.CallerKind,
				CallerId:      sample.CallerID,
				Capability:    sample.Capability,
				ModelId:       sample.ModelID,
				Window:        window,
				BucketStart:   timestamppb.New(bucket),
			}
			agg[key] = item
		}
		item.RequestCount++
		if sample.Success {
			item.SuccessCount++
		} else {
			item.ErrorCount++
		}
		item.QueueWaitMs += sample.QueueWaitMs
		if sample.Usage != nil {
			item.InputTokens += sample.Usage.GetInputTokens()
			item.OutputTokens += sample.Usage.GetOutputTokens()
			item.ComputeMs += sample.Usage.GetComputeMs()
		}
	}
	s.usageMu.RUnlock()

	records := make([]*runtimev1.UsageStatRecord, 0, len(agg))
	for _, item := range agg {
		records = append(records, item)
	}
	sort.Slice(records, func(i, j int) bool {
		left := records[i].GetBucketStart().AsTime()
		right := records[j].GetBucketStart().AsTime()
		if left.Equal(right) {
			if records[i].GetCapability() == records[j].GetCapability() {
				return records[i].GetCallerId() < records[j].GetCallerId()
			}
			return records[i].GetCapability() < records[j].GetCapability()
		}
		return left.After(right)
	})

	start, err := parsePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	if start > len(records) {
		start = 0
	}

	pageSize := boundedPageSize(req.GetPageSize(), 200)
	end := start + pageSize
	if end > len(records) {
		end = len(records)
	}
	nextToken := ""
	if end < len(records) {
		nextToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}

	return &runtimev1.ListUsageStatsResponse{
		Records:       records[start:end],
		NextPageToken: nextToken,
	}, nil
}

func matchesUsageFilter(sample UsageInput, req *runtimev1.ListUsageStatsRequest) bool {
	if req == nil {
		return true
	}
	if req.GetAppId() != "" && req.GetAppId() != sample.AppID {
		return false
	}
	if req.GetSubjectUserId() != "" && req.GetSubjectUserId() != sample.SubjectUserID {
		return false
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED && req.GetCallerKind() != sample.CallerKind {
		return false
	}
	if req.GetCallerId() != "" && req.GetCallerId() != sample.CallerID {
		return false
	}
	if req.GetCapability() != "" && req.GetCapability() != sample.Capability {
		return false
	}
	if req.GetModelId() != "" && req.GetModelId() != sample.ModelID {
		return false
	}
	if req.GetFromTime() != nil && sample.Timestamp.Before(req.GetFromTime().AsTime()) {
		return false
	}
	if req.GetToTime() != nil && sample.Timestamp.After(req.GetToTime().AsTime()) {
		return false
	}
	return true
}

func normalizeWindow(window runtimev1.UsageWindow) runtimev1.UsageWindow {
	if window == runtimev1.UsageWindow_USAGE_WINDOW_UNSPECIFIED {
		return runtimev1.UsageWindow_USAGE_WINDOW_MINUTE
	}
	return window
}

func truncateByWindow(ts time.Time, window runtimev1.UsageWindow) time.Time {
	switch window {
	case runtimev1.UsageWindow_USAGE_WINDOW_DAY:
		y, m, d := ts.UTC().Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	case runtimev1.UsageWindow_USAGE_WINDOW_HOUR:
		return ts.UTC().Truncate(time.Hour)
	default:
		return ts.UTC().Truncate(time.Minute)
	}
}

func parsePageToken(token string, filterDigest string) (int, error) {
	if strings.TrimSpace(token) == "" {
		return 0, nil
	}
	cursor, err := pagination.ValidatePageToken(token, filterDigest)
	if err != nil {
		return 0, err
	}
	value, convErr := strconv.Atoi(cursor)
	if convErr != nil {
		return 0, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PAGE_TOKEN_INVALID,
			convErr,
			grpcerr.ReasonOptions{
				ActionHint: "provide_valid_page_token",
				Message:    "audit page token cursor is invalid",
			},
		)
	}
	if value < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	return value, nil
}

func cloneAuditEvent(input *runtimev1.AuditEventRecord) *runtimev1.AuditEventRecord {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	recordCopy, ok := cloned.(*runtimev1.AuditEventRecord)
	if !ok {
		return nil
	}
	return recordCopy
}

func cloneUsage(input *runtimev1.UsageStats) *runtimev1.UsageStats {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	statsCopy, ok := cloned.(*runtimev1.UsageStats)
	if !ok {
		return nil
	}
	return statsCopy
}

func isSensitiveKey(key string) bool {
	return auditredaction.IsSensitiveKey(key)
}

func maskValue(value string) string {
	return auditredaction.MaskValue(value)
}

func maskSensitiveFields(fields map[string]*structpb.Value) {
	auditredaction.MaskSensitiveFields(fields)
}

func eventFilterDigest(req *runtimev1.ListAuditEventsRequest) string {
	if req == nil {
		return pagination.FilterDigest()
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetSubjectUserId()),
		strings.TrimSpace(req.GetDomain()),
		req.GetReasonCode().String(),
		req.GetCallerKind().String(),
		strings.TrimSpace(req.GetCallerId()),
		formatPageTime(req.GetFromTime()),
		formatPageTime(req.GetToTime()),
	)
}

func desktopEventFilterDigest(req *runtimev1.ListDesktopAuditEventsRequest) string {
	if req == nil {
		return pagination.FilterDigest()
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetTraceId()),
		strings.TrimSpace(req.GetRequestId()),
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetDomain()),
		strings.TrimSpace(req.GetOperation()),
		req.GetReasonCode().String(),
		req.GetCallerKind().String(),
		formatPageTime(req.GetFromTime()),
		formatPageTime(req.GetToTime()),
	)
}

func usageFilterDigest(req *runtimev1.ListUsageStatsRequest, window runtimev1.UsageWindow) string {
	if req == nil {
		return pagination.FilterDigest(window.String())
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetSubjectUserId()),
		req.GetCallerKind().String(),
		strings.TrimSpace(req.GetCallerId()),
		strings.TrimSpace(req.GetCapability()),
		strings.TrimSpace(req.GetModelId()),
		formatPageTime(req.GetFromTime()),
		formatPageTime(req.GetToTime()),
		window.String(),
	)
}

func formatPageTime(ts *timestamppb.Timestamp) string {
	if ts == nil {
		return ""
	}
	return ts.AsTime().UTC().Format(time.RFC3339Nano)
}

// CommittedDiagnostic is an additional outcome, not an error that denies an
// already committed effect. Never include the storage error's private detail.
func CommittedDiagnostic(err error) *runtimev1.ErrorInfo {
	if err == nil {
		return nil
	}
	return &runtimev1.ErrorInfo{ReasonCode: runtimev1.ReasonCode_AUDIT_RESULT_UNRECORDED, ActionHint: "inspect_runtime_audit", Message: "The change committed, but its audit result was not recorded. Do not repeat the change."}
}
