package appactivity

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Backend is the Runtime persistence backend seam used by the activity owner.
type Backend interface {
	DB() *sql.DB
	WriteTx(ctx context.Context, fn func(*sql.Tx) error) error
}

// SourceFacts are the current registration facts of a Registered App Subject.
type SourceFacts struct {
	AppID          string
	DisplayName    string
	Active         bool
	SourceClass    string
	LaunchSelector []byte
}

const (
	SourceClassVerified         = "verified"
	SourceClassUserImported     = "user_imported"
	SourceClassLocalDevelopment = "local_development"
)

// RegistrationResolver resolves the trusted source display, availability, and
// Desktop launch facts of a Registered App Subject.
type RegistrationResolver interface {
	ActivitySource(ctx context.Context, registeredAppSubject string) (SourceFacts, error)
}

// AgentFacts is the private Agent association resolved from a session handle.
type AgentFacts struct {
	LocalAgentRef string
	DisplayName   string
}

// AgentResolver resolves a session-scoped handle in the publication transaction,
// serializing its lifecycle check with Agent termination and activity cleanup.
type AgentResolver interface {
	ResolveAppActivityAgentTx(ctx context.Context, tx *sql.Tx, agentHandle string) (AgentFacts, error)
}

// IngressRevalidator re-runs protected App admission for long-lived streams.
type IngressRevalidator interface {
	AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error)
}

type Options struct {
	Backend       Backend
	Registrations RegistrationResolver
	Agents        AgentResolver
	Revalidator   IngressRevalidator
	Logger        *slog.Logger
	Now           func() time.Time
}

// @nimi-authority: definition.nimi.runtime.app-surface.app-activity-plane
// Service is the Runtime App activity owner.
type Service struct {
	backend       Backend
	registrations RegistrationResolver
	agents        AgentResolver
	revalidator   IngressRevalidator
	logger        *slog.Logger
	now           func() time.Time

	mu     sync.Mutex
	closed bool
	wakers map[string]chan struct{}
	opens  *openBroker

	lifecycleCtx    context.Context
	lifecycleCancel context.CancelFunc
	workers         sync.WaitGroup
	retentionMu     sync.Mutex
	rootQuiesced    atomic.Bool
}

func New(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	ctx, cancel := context.WithCancel(context.Background())
	service := &Service{
		backend: options.Backend, registrations: options.Registrations, agents: options.Agents,
		revalidator: options.Revalidator, logger: logger, now: now,
		wakers: make(map[string]chan struct{}), lifecycleCtx: ctx, lifecycleCancel: cancel,
	}
	service.opens = newOpenBroker(service)
	return service
}

// SetAgentResolver completes wiring when the Agent owner is constructed after
// the activity owner.
func (s *Service) SetAgentResolver(resolver AgentResolver) {
	if s != nil {
		s.agents = resolver
	}
}

// SetIngressRevalidator completes wiring with the protected App admission owner.
func (s *Service) SetIngressRevalidator(revalidator IngressRevalidator) {
	if s != nil {
		s.revalidator = revalidator
	}
}

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	for accountID, waker := range s.wakers {
		close(waker)
		delete(s.wakers, accountID)
	}
	s.mu.Unlock()
	s.lifecycleCancel()
	s.opens.closeAll()
	s.workers.Wait()
	return nil
}

func (s *Service) available() bool {
	if s == nil || s.backend == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.closed && !s.rootQuiesced.Load()
}

// NotifyCommitted wakes live subscribers after a committed account change.
func (s *Service) NotifyCommitted(accountID string) {
	if s == nil || accountID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	if waker, ok := s.wakers[accountID]; ok {
		close(waker)
		s.wakers[accountID] = make(chan struct{})
	}
}

func (s *Service) waker(accountID string) <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		closed := make(chan struct{})
		close(closed)
		return closed
	}
	waker, ok := s.wakers[accountID]
	if !ok {
		waker = make(chan struct{})
		s.wakers[accountID] = waker
	}
	return waker
}

// @nimi-authority: rule.nimi.runtime.app-surface.r102
func (s *Service) decision(ctx context.Context, operation localappop.Operation) (accountservice.LocalAppCallerDecision, error) {
	if !s.available() {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != operation || decision.AuthorityClass != localappop.AuthorityClassAppAccess ||
		decision.OperationCapability != AppAccessDomain ||
		strings.TrimSpace(decision.AccountID) == "" || decision.AccountID != strings.TrimSpace(decision.AccountID) ||
		strings.TrimSpace(decision.RegisteredAppSubject) == "" ||
		decision.RegisteredAppSubject != strings.TrimSpace(decision.RegisteredAppSubject) ||
		decision.ExpiresAt.IsZero() || !s.now().UTC().Before(decision.ExpiresAt.UTC()) || closed(decision.SessionInvalidated) {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	return decision, nil
}

// AppAccessDomain is the declaration domain governing every activity operation.
const AppAccessDomain = "app.activity"

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-001
func (s *Service) PutAppActivity(ctx context.Context, req *runtimev1.PutAppActivityRequest) (*runtimev1.PutAppActivityResponse, error) {
	decision, err := s.decision(ctx, localappop.OperationAppActivityPut)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	input, err := validatePutRequest(req, now)
	if err != nil {
		return nil, publicError(err)
	}
	var record storedRecord
	var changed bool
	err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		agent := AgentFacts{}
		if input.AgentHandle != "" {
			if s.agents == nil {
				return ErrAgentUnavailable
			}
			var agentErr error
			agent, agentErr = s.agents.ResolveAppActivityAgentTx(ctx, tx, input.AgentHandle)
			if agentErr != nil || strings.TrimSpace(agent.LocalAgentRef) == "" {
				return ErrAgentUnavailable
			}
		}
		var txErr error
		record, changed, txErr = publishTx(ctx, tx, decision.AccountID, publisherKindApp, decision.RegisteredAppSubject, input, agent, now.UnixMilli())
		return txErr
	})
	if err != nil {
		return nil, publicError(err)
	}
	if changed {
		s.NotifyCommitted(decision.AccountID)
	}
	projected, err := s.project(ctx, decision.AccountID, record.image(), newSourceCache())
	if err != nil {
		return nil, publicError(err)
	}
	return &runtimev1.PutAppActivityResponse{Record: projected, Changed: changed}, nil
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-004
func (s *Service) MarkAppActivityRead(ctx context.Context, req *runtimev1.MarkAppActivityReadRequest) (*runtimev1.MarkAppActivityReadResponse, error) {
	decision, err := s.decision(ctx, localappop.OperationAppActivityMarkRead)
	if err != nil {
		return nil, err
	}
	if req == nil || !validActivityID(req.GetActivityId()) || req.GetDisplayedRevision() == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	nowMS := s.now().UTC().UnixMilli()
	var record storedRecord
	var changed bool
	err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var txErr error
		record, changed, txErr = markReadTx(ctx, tx, decision.AccountID, req.GetActivityId(), req.GetDisplayedRevision(), nowMS)
		return txErr
	})
	if err != nil {
		return nil, publicError(err)
	}
	if changed {
		s.NotifyCommitted(decision.AccountID)
	}
	projected, err := s.project(ctx, decision.AccountID, record.image(), newSourceCache())
	if err != nil {
		return nil, publicError(err)
	}
	return &runtimev1.MarkAppActivityReadResponse{Record: projected}, nil
}

type pageToken struct {
	Version        int    `json:"v"`
	Baseline       uint64 `json:"b"`
	AfterCreateSeq uint64 `json:"c"`
	AfterID        string `json:"i"`
	FilterDigest   string `json:"f"`
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-003
func (s *Service) ListAppActivities(ctx context.Context, req *runtimev1.ListAppActivitiesRequest) (*runtimev1.ListAppActivitiesResponse, error) {
	decision, err := s.decision(ctx, localappop.OperationAppActivityList)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	filter, filterDigest, err := validateFilter(req.GetFilter())
	if err != nil {
		return nil, publicError(err)
	}
	// Continuations are bound to the account partition as well as the filter,
	// so a token cannot continue a listing across an account change.
	digest := shortDigest("nimi.runtime.app-activity.page/v1", decision.AccountID, filterDigest)
	pageSize := int(req.GetPageSize())
	if pageSize == 0 {
		pageSize = DefaultPageSize
	}
	if pageSize < 0 || pageSize > MaxPageSize {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	token := pageToken{}
	if raw := req.GetPageToken(); raw != "" {
		token, err = decodePageToken(raw)
		if err != nil || token.FilterDigest != digest {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_PAGE_TOKEN_INVALID)
		}
	}
	tx, err := s.backend.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	}
	defer func() { _ = tx.Rollback() }()
	if req.GetPageToken() == "" {
		last, _, seqErr := accountSequence(ctx, tx, decision.AccountID)
		if seqErr != nil {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
		}
		token = pageToken{Version: 1, Baseline: last, FilterDigest: digest}
	}
	records, err := listPage(ctx, tx, decision.AccountID, filter, token.Baseline, token.AfterCreateSeq, token.AfterID, pageSize+1)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	}
	response := &runtimev1.ListAppActivitiesResponse{BaselineChangeSeq: token.Baseline}
	if len(records) > pageSize {
		records = records[:pageSize]
		last := records[len(records)-1]
		next := pageToken{Version: 1, Baseline: token.Baseline, AfterCreateSeq: last.CreateSeq, AfterID: last.ActivityID, FilterDigest: digest}
		response.NextPageToken = encodePageToken(next)
	}
	sources := newSourceCache()
	for _, record := range records {
		projected, err := s.project(ctx, decision.AccountID, record.image(), sources)
		if err != nil {
			return nil, publicError(err)
		}
		response.Records = append(response.Records, projected)
	}
	return response, nil
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-003
// @nimi-authority: rule.nimi.runtime.app-surface.r101
func (s *Service) SubscribeAppActivityChanges(req *runtimev1.SubscribeAppActivityChangesRequest, stream runtimev1.RuntimeAppActivityService_SubscribeAppActivityChangesServer) error {
	ctx := stream.Context()
	decision, err := s.decision(ctx, localappop.OperationAppActivitySubscribe)
	if err != nil {
		return err
	}
	if req == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	}
	cursor := req.GetAfterChangeSeq()
	revalidate := time.NewTicker(time.Second)
	defer revalidate.Stop()
	const batch = 128
	sources := newSourceCache()
	for {
		if !s.sessionLive(ctx, localappop.IngressAppActivitySubscribe, decision.AccountID, sessionKey(decision),
			decision.ExpiresAt, decision.SessionInvalidated) {
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		}
		wake := s.waker(decision.AccountID)
		last, floor, err := accountSequence(ctx, s.backend.DB(), decision.AccountID)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
		}
		if cursor < floor || cursor > last {
			return grpcerr.WithReasonCode(codes.OutOfRange, runtimev1.ReasonCode_APP_ACTIVITY_CURSOR_EXPIRED)
		}
		changes, err := loadChangesAfter(ctx, s.backend.DB(), decision.AccountID, cursor, batch)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
		}
		if len(changes) > 0 && changes[0].Seq != cursor+1 {
			// A retained change below the next expected sequence was purged
			// between the floor read and this batch.
			return grpcerr.WithReasonCode(codes.OutOfRange, runtimev1.ReasonCode_APP_ACTIVITY_CURSOR_EXPIRED)
		}
		for index, change := range changes {
			if index > 0 && change.Seq != changes[index-1].Seq+1 {
				return grpcerr.WithReasonCode(codes.OutOfRange, runtimev1.ReasonCode_APP_ACTIVITY_CURSOR_EXPIRED)
			}
			response := &runtimev1.SubscribeAppActivityChangesResponse{ChangeSeq: change.Seq, ActivityId: change.ActivityID}
			switch change.Kind {
			case changeKindUpsert:
				projected, err := s.project(ctx, decision.AccountID, change.Image, sources)
				if err != nil {
					return publicError(err)
				}
				response.Kind = runtimev1.AppActivityChangeKind_APP_ACTIVITY_CHANGE_KIND_UPSERT
				response.Record = projected
			case changeKindRemove:
				response.Kind = runtimev1.AppActivityChangeKind_APP_ACTIVITY_CHANGE_KIND_REMOVE
			default:
				return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
			}
			if !s.sessionLive(ctx, localappop.IngressAppActivitySubscribe, decision.AccountID, sessionKey(decision),
				decision.ExpiresAt, decision.SessionInvalidated) {
				return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
			}
			if err := stream.Send(response); err != nil {
				return err
			}
			cursor = change.Seq
		}
		if len(changes) == batch {
			continue
		}
		select {
		case <-ctx.Done():
			return nil
		case <-s.lifecycleCtx.Done():
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
		case <-decision.SessionInvalidated:
			return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		case <-wake:
		case <-revalidate.C:
			sources = newSourceCache()
		}
	}
}

func validateFilter(filter *runtimev1.AppActivityFilter) (listFilter, string, error) {
	result := listFilter{}
	if filter != nil {
		if ref := filter.GetSourceRef(); ref != "" {
			if !strings.HasPrefix(ref, "src_") || !boundedLine(ref, 64) {
				return listFilter{}, "", fmt.Errorf("%w: source filter", ErrInvalidInput)
			}
			result.SourceRef = ref
		}
		switch filter.GetKind() {
		case runtimev1.AppActivityKind_APP_ACTIVITY_KIND_UNSPECIFIED:
		case runtimev1.AppActivityKind_APP_ACTIVITY_KIND_ACTIVITY:
			result.Kind = kindActivity
		case runtimev1.AppActivityKind_APP_ACTIVITY_KIND_TODO:
			result.Kind = kindTodo
		default:
			return listFilter{}, "", fmt.Errorf("%w: kind filter", ErrInvalidInput)
		}
		seen := map[string]bool{}
		for _, state := range filter.GetTodoStates() {
			text, ok := todoStateText(state)
			if !ok || seen[text] {
				return listFilter{}, "", fmt.Errorf("%w: state filter", ErrInvalidInput)
			}
			seen[text] = true
			result.TodoStates = append(result.TodoStates, text)
		}
		if ref := filter.GetAgentRef(); ref != "" {
			if !strings.HasPrefix(ref, "agr_") || !boundedLine(ref, 64) {
				return listFilter{}, "", fmt.Errorf("%w: Agent filter", ErrInvalidInput)
			}
			result.AgentRef = ref
		}
		if after := filter.GetOccurredAfter(); after != nil {
			if !after.IsValid() {
				return listFilter{}, "", fmt.Errorf("%w: time filter", ErrInvalidInput)
			}
			result.OccurredAfter = after.AsTime().UnixMilli()
		}
		if before := filter.GetOccurredBefore(); before != nil {
			if !before.IsValid() {
				return listFilter{}, "", fmt.Errorf("%w: time filter", ErrInvalidInput)
			}
			result.OccurredBefore = before.AsTime().UnixMilli()
		}
	}
	encoded, _ := json.Marshal(result)
	return result, shortDigest("nimi.runtime.app-activity.filter/v1", string(encoded)), nil
}

func encodePageToken(token pageToken) string {
	encoded, _ := json.Marshal(token)
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodePageToken(raw string) (pageToken, error) {
	if len(raw) > 512 {
		return pageToken{}, ErrPageToken
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return pageToken{}, ErrPageToken
	}
	var token pageToken
	if err := json.Unmarshal(decoded, &token); err != nil || token.Version != 1 || token.AfterCreateSeq == 0 ||
		token.AfterCreateSeq > token.Baseline || !validActivityID(token.AfterID) {
		return pageToken{}, ErrPageToken
	}
	return token, nil
}

type sourceCache map[string]SourceFacts

func newSourceCache() sourceCache { return sourceCache{} }

// project resolves the current trusted source display and the shared user
// view for one committed image.
func (s *Service) project(ctx context.Context, accountID string, image recordImage, cache sourceCache) (*runtimev1.AppActivityRecord, error) {
	source := &runtimev1.AppActivitySource{SourceRef: image.SourceRef}
	switch image.PublisherKind {
	case publisherKindApp:
		source.Kind = runtimev1.AppActivitySourceKind_APP_ACTIVITY_SOURCE_KIND_APP
		facts, ok := cache[image.PublisherRef]
		if !ok {
			resolved, err := s.registrations.ActivitySource(ctx, image.PublisherRef)
			if err != nil {
				resolved = SourceFacts{}
			}
			facts = resolved
			cache[image.PublisherRef] = facts
		}
		source.AppId = facts.AppID
		source.DisplayName = facts.DisplayName
		source.Available = facts.Active
	case publisherKindRuntimeAgent:
		source.Kind = runtimev1.AppActivitySourceKind_APP_ACTIVITY_SOURCE_KIND_RUNTIME_AGENT
		source.Available = true
	default:
		return nil, ErrUnavailable
	}
	record := &runtimev1.AppActivityRecord{
		ActivityId: image.ActivityID, Source: source, Key: image.Key, Revision: image.Revision,
		Attention: image.Attention, Title: image.Title, Summary: image.Summary, ObjectRef: image.ObjectRef,
		ActivityType: image.ActivityType, DataJson: image.DataJSON,
		OccurredAt:  timestamppb.New(time.UnixMilli(image.OccurredAtMS).UTC()),
		PublishedAt: timestamppb.New(time.UnixMilli(image.PublishedAtMS).UTC()),
		UpdatedAt:   timestamppb.New(time.UnixMilli(image.UpdatedAtMS).UTC()),
		ChangeSeq:   image.ChangeSeq,
	}
	switch image.Kind {
	case kindActivity:
		record.Kind = runtimev1.AppActivityKind_APP_ACTIVITY_KIND_ACTIVITY
	case kindTodo:
		record.Kind = runtimev1.AppActivityKind_APP_ACTIVITY_KIND_TODO
		switch image.TodoState {
		case todoStateOpen:
			record.TodoState = runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN
		case todoStateCompleted:
			record.TodoState = runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_COMPLETED
		case todoStateCancelled:
			record.TodoState = runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_CANCELLED
		default:
			return nil, ErrUnavailable
		}
	default:
		return nil, ErrUnavailable
	}
	if image.AgentRef != "" {
		record.Agent = &runtimev1.AppActivityAgentAssociation{AgentRef: image.AgentRef, DisplayName: image.AgentDisplayName}
	}
	unread := image.Revision > image.ReadThroughRevision
	needsAttention := unread && image.Attention && (image.Kind == kindActivity || image.TodoState == todoStateOpen)
	record.UserView = &runtimev1.AppActivityUserView{
		ReadThroughRevision: image.ReadThroughRevision, Unread: unread, NeedsAttention: needsAttention,
	}
	_ = accountID
	return record, nil
}

func publicError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrInvalidInput):
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_INPUT_INVALID)
	case errors.Is(err, ErrTooLarge):
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_TOO_LARGE)
	case errors.Is(err, ErrConflict):
		return grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_ACTIVITY_REVISION_CONFLICT)
	case errors.Is(err, ErrNotFound):
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_ACTIVITY_NOT_FOUND)
	case errors.Is(err, ErrPageToken):
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_ACTIVITY_PAGE_TOKEN_INVALID)
	case errors.Is(err, ErrCursorExpired):
		return grpcerr.WithReasonCode(codes.OutOfRange, runtimev1.ReasonCode_APP_ACTIVITY_CURSOR_EXPIRED)
	case errors.Is(err, ErrAccountFenced):
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	case errors.Is(err, ErrAgentUnavailable):
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_ACTIVITY_AGENT_UNAVAILABLE)
	case errors.Is(err, context.Canceled):
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	default:
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_ACTIVITY_UNAVAILABLE)
	}
}
