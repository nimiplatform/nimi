// Package integration owns shared operation admission, dispatch and call facts.
// Business goals, waiting conditions and recovery remain in the consuming App.
package integration

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const maxInput = 256 * 1024
const maxOutput = 1024 * 1024
const retention = 30 * 24 * time.Hour
const resultRetention = 15 * time.Minute
const maxRetainedCalls = 512
const maxActiveCallsPerScope = 32
const terminalRecordTimeout = 5 * time.Second

type Backend interface {
	DB() *sql.DB
	WriteTx(context.Context, func(*sql.Tx) error) error
}
type Revalidator interface {
	AuthorizeLocalAppIngress(context.Context, localappop.Ingress) (context.Context, error)
}
type Consumer struct{ Subject, AppID, DisplayName, SourceKind string }
type Registrations interface {
	Consumers(context.Context) ([]Consumer, error)
	// DescribeConsumer is display-only and may describe an ineligible subject.
	DescribeConsumer(context.Context, string) (Consumer, bool, error)
}
type Options struct {
	Backend       Backend
	Secrets       connector.SecretStore
	Revalidator   Revalidator
	Registrations Registrations
	HTTPClient    *http.Client
}
type target struct {
	Account       string                       `json:"account"`
	Subject       string                       `json:"subject,omitempty"`
	Endpoint      string                       `json:"endpoint,omitempty"`
	TelegramBotID int64                        `json:"telegramBotId,omitempty"`
	Public        *runtimev1.IntegrationTarget `json:"public"`
}
type invocation struct {
	decision        accountservice.LocalAppCallerDecision
	ctx             context.Context
	cancel          context.CancelFunc
	target          target
	op              *runtimev1.IntegrationOperation
	input           string
	credential      string
	expiry          *time.Timer
	fact            *runtimev1.IntegrationCall
	providerSession protectedlocal.Identifier
	delivered       bool
	cancelNotified  bool
	cancelRequested bool
	done            chan struct{}
}
type provider struct {
	target   target
	decision accountservice.LocalAppCallerDecision
	ctx      context.Context
	cancel   context.CancelFunc
}

// @nimi-authority: rule.nimi.runtime.integration.fixed-operations
type Service struct {
	runtimev1.UnimplementedRuntimeIntegrationServiceServer
	backend       Backend
	secrets       connector.SecretStore
	revalidator   Revalidator
	registrations Registrations
	http          *http.Client
	ctx           context.Context
	cancel        context.CancelFunc
	mu            sync.Mutex
	providers     map[string]*provider
	calls         map[string]*invocation
	receivers     map[string]*telegramReceiver
	workers       sync.WaitGroup
	closed        bool
	quiesced      atomic.Bool
	closeDone     chan struct{}
	drainDone     chan struct{}
	resumePending bool
}

func New(o Options) (*Service, error) {
	if o.Backend == nil {
		return nil, errors.New("integration: persistence required")
	}
	client := o.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{backend: o.Backend, secrets: o.Secrets, revalidator: o.Revalidator, registrations: o.Registrations, http: client, ctx: ctx, cancel: cancel, providers: map[string]*provider{}, calls: map[string]*invocation{}, receivers: map[string]*telegramReceiver{}, closeDone: make(chan struct{})}
	// A new Runtime does not resume any previously accepted operation.
	if _, err := s.backend.DB().ExecContext(ctx, `UPDATE runtime_integration_call SET status='unconfirmed', error_code='EXECUTOR_RESTARTED' WHERE status='accepted'`); err != nil {
		cancel()
		return nil, fmt.Errorf("integration recover call facts: %w", err)
	}
	return s, nil
}
func failure(code codes.Code, message string) error {
	// These are operation-owner failures, not loss of the consumer's protected
	// transport. Typed reasons keep a provider outage or configuration conflict
	// from invalidating unrelated App resources and closing its renderer.
	options := grpcerr.ReasonOptions{Message: message, Metadata: map[string]string{"integration_reason": message}}
	switch code {
	case codes.Unavailable, codes.DeadlineExceeded:
		return grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, options)
	case codes.FailedPrecondition, codes.AlreadyExists:
		return grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, options)
	default:
		return status.Error(code, message)
	}
}
func closed(ch <-chan struct{}) bool {
	if ch == nil {
		return false
	}
	select {
	case <-ch:
		return true
	default:
		return false
	}
}
func ref(prefix string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return prefix + hex.EncodeToString(sum[:16])
}
func sameScope(a, b accountservice.LocalAppCallerDecision) bool {
	return a.AccountID == b.AccountID && a.RegisteredAppSubject == b.RegisteredAppSubject && a.SessionID == b.SessionID && a.RuntimeBootEpoch == b.RuntimeBootEpoch
}
func (s *Service) decision(ctx context.Context, op localappop.Operation) (accountservice.LocalAppCallerDecision, error) {
	d, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	classification, err := localappop.ClassifyOperation(op)
	if !ok || err != nil || d.Operation != op || d.AuthorityClass != localappop.AuthorityClassAppAccess || d.OperationCapability != string(classification.Domain) || d.AccountID == "" || d.RegisteredAppSubject == "" || d.SessionID == (protectedlocal.Identifier{}) || !time.Now().Before(d.ExpiresAt) || closed(d.SessionInvalidated) || s.ctx.Err() != nil || s.quiesced.Load() {
		return d, failure(codes.PermissionDenied, "INTEGRATION_ACCESS_DENIED")
	}
	return d, nil
}
func (s *Service) management(ctx context.Context, op localappop.Operation) (accountservice.LocalAppCallerDecision, error) {
	d, err := s.decision(ctx, op)
	if err != nil {
		return d, err
	}
	connection, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || !connection.VerifiedDesktopTransport() || d.TrustClass != accountservice.LocalAppTrustClassBuiltIn || d.AppID != "nimi.desktop" {
		return d, failure(codes.PermissionDenied, "INTEGRATION_MANAGEMENT_DENIED")
	}
	return d, nil
}
func (s *Service) scopeLive(ctx context.Context, d accountservice.LocalAppCallerDecision, ingress localappop.Ingress) bool {
	if ctx.Err() != nil || closed(d.SessionInvalidated) || s.ctx.Err() != nil || s.quiesced.Load() {
		return false
	}
	if s.revalidator == nil {
		return time.Now().Before(d.ExpiresAt)
	}
	admitted, err := s.revalidator.AuthorizeLocalAppIngress(ctx, ingress)
	if err != nil {
		return false
	}
	next, ok := accountservice.AuthorizedLocalAppDecisionFromContext(admitted)
	return ok && sameScope(d, next)
}
func decodeJSON(raw string, limit int) (any, error) {
	if len(raw) == 0 || len(raw) > limit {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_PAYLOAD_BOUNDS")
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_JSON_INVALID")
	}
	return value, nil
}
func validateSchema(schema string, value any) error { return checkSchema(schema, value, true) }
func checkSchema(schema string, value any, validate bool) error {
	if len(schema) == 0 || len(schema) > 64*1024 {
		return failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_INVALID")
	}
	var doc any
	if json.Unmarshal([]byte(schema), &doc) != nil {
		return failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_INVALID")
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseLoader(noRemoteSchema{})
	if err := compiler.AddResource("urn:nimi:integration", doc); err != nil {
		return failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_INVALID")
	}
	compiled, err := compiler.Compile("urn:nimi:integration")
	if err != nil {
		return failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_INVALID")
	}
	if validate {
		if err := compiled.Validate(value); err != nil {
			return failure(codes.InvalidArgument, "INTEGRATION_SCHEMA_MISMATCH")
		}
	}
	return nil
}

type noRemoteSchema struct{}

func (noRemoteSchema) Load(string) (any, error) {
	return nil, errors.New("remote schema references unavailable")
}
func validateOperations(ops []*runtimev1.IntegrationOperation) error {
	if len(ops) == 0 || len(ops) > 128 {
		return failure(codes.InvalidArgument, "INTEGRATION_OPERATIONS_BOUNDS")
	}
	names := map[string]bool{}
	for _, op := range ops {
		if op == nil || len(op.Name) == 0 || len(op.Name) > 128 || strings.TrimSpace(op.Name) != op.Name || names[op.Name] || len(op.Description) > 4096 || (op.Effect != "read" && op.Effect != "write") || (op.RetryPolicy != "none" && op.RetryPolicy != "safe") {
			return failure(codes.InvalidArgument, "INTEGRATION_OPERATION_INVALID")
		}
		names[op.Name] = true
		if err := checkSchema(op.InputSchemaJson, nil, false); err != nil {
			return err
		}
		if err := checkSchema(op.OutputSchemaJson, nil, false); err != nil {
			return err
		}
	}
	return nil
}
func operation(t target, name string) *runtimev1.IntegrationOperation {
	for _, op := range t.Public.Operations {
		if op.Name == name {
			return op
		}
	}
	return nil
}
func cloneCall(c *runtimev1.IntegrationCall, body bool) *runtimev1.IntegrationCall {
	result := proto.Clone(c).(*runtimev1.IntegrationCall)
	if !body {
		result.ResultJson = ""
	}
	return result
}

// @nimi-authority: rule.nimi.runtime.integration.call-facts
func (s *Service) InvokeIntegrationCall(ctx context.Context, req *runtimev1.InvokeIntegrationCallRequest) (*runtimev1.InvokeIntegrationCallResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationCallInvoke)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	input, err := decodeJSON(req.InputJson, maxInput)
	if err != nil {
		return nil, err
	}
	consumerName := s.consumerDisplayName(ctx, d)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	// Configuration commits, revocation and admission share this mutation
	// boundary. The immutable target and credential are fixed before acceptance.
	t, err := s.loadTarget(ctx, d.AccountID, req.TargetRef)
	if err != nil {
		return nil, err
	}
	op := operation(t, req.Operation)
	if op == nil {
		return nil, failure(codes.NotFound, "INTEGRATION_OPERATION_NOT_FOUND")
	}
	if !s.permitted(ctx, d.AccountID, d.RegisteredAppSubject, req.TargetRef, req.Operation) {
		return nil, failure(codes.PermissionDenied, "INTEGRATION_PERMISSION_REQUIRED")
	}
	if t.Public.Kind == "telegram" && t.TelegramBotID <= 0 {
		return nil, failure(codes.FailedPrecondition, "INTEGRATION_TELEGRAM_VERIFICATION_REQUIRED")
	}
	if err := validateSchema(op.InputSchemaJson, input); err != nil {
		return nil, err
	}
	credential, err := s.captureCredential(t)
	if err != nil {
		return nil, err
	}
	providerSession := protectedlocal.Identifier{}
	if t.Public.Kind == "app" {
		p := s.providers[t.Public.TargetRef]
		if p == nil || !s.scopeLive(p.ctx, p.decision, localappop.IngressIntegrationProviderPoll) {
			return nil, failure(codes.Unavailable, "INTEGRATION_PROVIDER_UNAVAILABLE")
		}
		providerSession = p.decision.SessionID
	}
	active := 0
	for _, c := range s.calls {
		if c.fact.Status == "accepted" && sameScope(c.decision, d) {
			active++
		}
	}
	if active >= maxActiveCallsPerScope {
		return nil, failure(codes.ResourceExhausted, "INTEGRATION_CALL_LIMIT")
	}
	if !s.reserveCallSlotLocked(time.Now()) {
		return nil, failure(codes.ResourceExhausted, "INTEGRATION_CALL_LIMIT")
	}
	now := timestamppb.Now()
	fact := &runtimev1.IntegrationCall{CallId: "ic_" + ulid.Make().String(), TargetRef: t.Public.TargetRef, Operation: op.Name, Status: "accepted", ConsumerDisplayName: consumerName, TargetDisplayName: t.Public.DisplayName, AccountLabel: t.Public.AccountLabel, CreatedAt: now, UpdatedAt: now}
	if err := s.saveFact(ctx, d, fact); err != nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_CALL_RECORD_UNAVAILABLE")
	}
	execCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	c := &invocation{decision: d, ctx: execCtx, cancel: cancel, target: t, op: op, input: req.InputJson, credential: credential, fact: fact, providerSession: providerSession, done: make(chan struct{})}
	s.calls[fact.CallId] = c
	s.workers.Add(1)
	go s.run(c)
	return &runtimev1.InvokeIntegrationCallResponse{Call: cloneCall(fact, false)}, nil
}
func (s *Service) run(c *invocation) {
	defer s.workers.Done()
	watchDone := make(chan struct{})
	defer func() { c.cancel(); <-watchDone }()
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-s.ctx.Done():
				s.cancelInvocation(c)
				return
			case <-c.decision.SessionInvalidated:
				s.cancelInvocation(c)
				return
			case <-c.ctx.Done():
				return
			case <-ticker.C:
				if !s.scopeLive(c.ctx, c.decision, localappop.IngressIntegrationCallInvoke) || !s.permitted(c.ctx, c.decision.AccountID, c.decision.RegisteredAppSubject, c.target.Public.TargetRef, c.op.Name) {
					s.cancelInvocation(c)
					return
				}
			}
		}
	}()
	if !s.scopeLive(c.ctx, c.decision, localappop.IngressIntegrationCallInvoke) || !s.permitted(c.ctx, c.decision.AccountID, c.decision.RegisteredAppSubject, c.target.Public.TargetRef, c.op.Name) {
		s.finish(c, "canceled", "", "INTEGRATION_SCOPE_ENDED")
		return
	}
	if c.target.Public.Kind == "app" {
		select {
		case <-c.done:
			return
		case <-c.ctx.Done():
			s.mu.Lock()
			c.cancelRequested = true
			delivered := c.delivered
			s.mu.Unlock()
			state := "canceled"
			if delivered && c.op.Effect == "write" {
				state = "unconfirmed"
			}
			s.finish(c, state, "", "INTEGRATION_PROVIDER_INTERRUPTED")
			return
		}
	}
	result, dispatched, err := s.execute(c.ctx, c.target, c.op, c.input, c.credential)
	if err != nil {
		state := "failed"
		if dispatched && c.op.Effect == "write" {
			state = "unconfirmed"
		} else if c.ctx.Err() != nil {
			state = "canceled"
		}
		s.finish(c, state, "", publicAdapterError(err))
		return
	}
	value, err := decodeJSON(result, maxOutput)
	if err == nil {
		err = validateSchema(c.op.OutputSchemaJson, value)
	}
	if err != nil {
		state := "failed"
		if c.op.Effect == "write" {
			state = "unconfirmed"
		}
		s.finish(c, state, "", "INTEGRATION_RESULT_INVALID")
		return
	}
	s.finish(c, "completed", result, "")
}
func (s *Service) finish(c *invocation, state, result, reason string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.finishLocked(c, state, result, reason)
}

func (s *Service) finishLocked(c *invocation, state, result, reason string) bool {
	if c.fact.Status != "accepted" {
		return false
	}
	c.input, c.credential = "", ""
	c.fact.Status, c.fact.ResultJson, c.fact.ErrorCode = state, result, reason
	c.fact.UpdatedAt = timestamppb.Now()
	recordCtx, cancel := context.WithTimeout(context.Background(), terminalRecordTimeout)
	defer cancel()
	accepted := true
	if err := s.saveFact(recordCtx, c.decision, c.fact); err != nil {
		c.fact.Status, c.fact.ErrorCode, c.fact.ResultJson = "unconfirmed", "INTEGRATION_RESULT_RECORD_UNAVAILABLE", ""
		accepted = false
	}
	close(c.done)
	s.scheduleCallExpiryLocked(c)
	return accepted
}

func (s *Service) cancelInvocation(c *invocation) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancelInvocationLocked(c)
}
func (s *Service) cancelInvocationLocked(c *invocation) {
	if c.fact.Status == "accepted" {
		c.cancelRequested = true
	}
	c.cancel()
}

func (s *Service) GetIntegrationCall(ctx context.Context, req *runtimev1.GetIntegrationCallRequest) (*runtimev1.GetIntegrationCallResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationCallGet)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneCallsLocked(time.Now())
	c := s.calls[req.GetCallId()]
	if c != nil && sameScope(c.decision, d) {
		return &runtimev1.GetIntegrationCallResponse{Call: cloneCall(c.fact, true)}, nil
	}
	fact, err := s.loadFact(ctx, d, req.GetCallId())
	if err != nil {
		return nil, err
	}
	fact = s.knownFactLocked(fact, d.AccountID)
	if fact.Status == "completed" {
		fact.ErrorCode = "INTEGRATION_RESULT_EXPIRED"
	}
	return &runtimev1.GetIntegrationCallResponse{Call: fact}, nil
}
func (s *Service) CancelIntegrationCall(ctx context.Context, req *runtimev1.CancelIntegrationCallRequest) (*runtimev1.CancelIntegrationCallResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationCallCancel)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.calls[req.GetCallId()]
	if c == nil || !sameScope(c.decision, d) {
		return nil, failure(codes.NotFound, "INTEGRATION_CALL_NOT_FOUND")
	}
	s.cancelInvocationLocked(c)
	return &runtimev1.CancelIntegrationCallResponse{Call: cloneCall(c.fact, false)}, nil
}

func compatibleOperations(old, next []*runtimev1.IntegrationOperation) bool {
	for _, previous := range old {
		var current *runtimev1.IntegrationOperation
		for _, candidate := range next {
			if previous.Name == candidate.Name {
				current = candidate
				break
			}
		}
		if current == nil || previous.InputSchemaJson != current.InputSchemaJson || previous.OutputSchemaJson != current.OutputSchemaJson || previous.Effect != current.Effect || previous.SupportsCancel != current.SupportsCancel || previous.RetryPolicy != current.RetryPolicy {
			return false
		}
	}
	return true
}
