package integration

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.integration.provider-lifetime
func (s *Service) RegisterIntegrationProvider(ctx context.Context, req *runtimev1.RegisterIntegrationProviderRequest) (*runtimev1.RegisterIntegrationProviderResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationProviderRegister)
	if err != nil {
		return nil, err
	}
	if req == nil || len(req.IntegrationId) == 0 || len(req.IntegrationId) > 128 || len(req.DisplayName) == 0 || len(req.DisplayName) > 256 || len(req.Skill) > 16384 {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_PROVIDER_INPUT_INVALID")
	}
	if err := validateOperations(req.Operations); err != nil {
		return nil, err
	}
	// This first provider surface supports bounded local handlers, not nested
	// delegated execution. Do not claim cancellation/retry absent a handler contract.
	for _, op := range req.Operations {
		if op.SupportsCancel || op.RetryPolicy != "none" {
			return nil, failure(codes.InvalidArgument, "INTEGRATION_PROVIDER_BEHAVIOR_UNSUPPORTED")
		}
	}
	id := ref("iap_", d.AccountID, d.RegisteredAppSubject, req.IntegrationId)
	t := target{Account: d.AccountID, Subject: d.RegisteredAppSubject, Public: &runtimev1.IntegrationTarget{TargetRef: id, IntegrationId: req.IntegrationId, DisplayName: req.DisplayName, Kind: "app", Available: true, Operations: req.Operations, Skill: req.Skill}}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	if previous := s.providers[id]; previous != nil && !sameScope(previous.decision, d) {
		return nil, failure(codes.AlreadyExists, "INTEGRATION_PROVIDER_ALREADY_ACTIVE")
	}
	if old, err := s.loadTarget(ctx, d.AccountID, id); err == nil {
		if !compatibleOperations(old.Public.Operations, t.Public.Operations) {
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_PROVIDER_CONTRACT_CHANGED")
		}

	}
	if err := s.saveTarget(ctx, t); err != nil {
		return nil, err
	}
	if previous := s.providers[id]; previous != nil {
		previous.cancel()
	}
	providerCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	p := &provider{target: t, decision: d, ctx: providerCtx, cancel: cancel}
	s.providers[id] = p
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		defer cancel()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		defer s.removeProvider(id, p)
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-providerCtx.Done():
				return
			case <-d.SessionInvalidated:
				return
			case <-ticker.C:
				if !s.scopeLive(providerCtx, d, localappop.IngressIntegrationProviderPoll) {
					return
				}
			}
		}
	}()
	return &runtimev1.RegisterIntegrationProviderResponse{Target: proto.Clone(t.Public).(*runtimev1.IntegrationTarget)}, nil
}
func (s *Service) removeProvider(id string, p *provider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.providers[id] != p {
		return
	}
	delete(s.providers, id)
	for _, c := range s.calls {
		if c.target.Public.TargetRef == id && c.providerSession == p.decision.SessionID {
			s.cancelInvocationLocked(c)
		}
	}
}
func (s *Service) UnregisterIntegrationProvider(ctx context.Context, req *runtimev1.UnregisterIntegrationProviderRequest) (*runtimev1.UnregisterIntegrationProviderResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationProviderUnregister)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	p := s.providers[req.GetTargetRef()]
	if p == nil || !sameScope(p.decision, d) {
		s.mu.Unlock()
		return nil, failure(codes.NotFound, "INTEGRATION_PROVIDER_NOT_FOUND")
	}
	p.cancel()
	s.mu.Unlock()
	s.removeProvider(req.GetTargetRef(), p)
	return &runtimev1.UnregisterIntegrationProviderResponse{Removed: true}, nil
}
func (s *Service) PollIntegrationProvider(ctx context.Context, req *runtimev1.PollIntegrationProviderRequest) (*runtimev1.PollIntegrationProviderResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationProviderPoll)
	if err != nil {
		return nil, err
	}
	wait := req.GetWaitMs()
	if wait > 25000 {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_WAIT_LIMIT")
	}
	deadline := time.NewTimer(time.Duration(wait) * time.Millisecond)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		if !s.scopeLive(ctx, d, localappop.IngressIntegrationProviderPoll) {
			return nil, failure(codes.PermissionDenied, "INTEGRATION_SCOPE_ENDED")
		}
		result := &runtimev1.PollIntegrationProviderResponse{}
		s.mu.Lock()
		for _, c := range s.calls {
			if c.target.Subject != d.RegisteredAppSubject || c.target.Account != d.AccountID || c.providerSession != d.SessionID {
				continue
			}
			if c.delivered && !c.cancelNotified && c.cancelRequested {
				c.cancelNotified = true
				result.CanceledCallIds = append(result.CanceledCallIds, c.fact.CallId)
				continue
			}
			if c.fact.Status != "accepted" || c.delivered || c.ctx.Err() != nil {
				continue
			}
			if !s.scopeLive(c.ctx, c.decision, localappop.IngressIntegrationCallInvoke) || !s.permitted(ctx, c.decision.AccountID, c.decision.RegisteredAppSubject, c.target.Public.TargetRef, c.op.Name) {
				s.cancelInvocationLocked(c)
				continue
			}
			c.delivered = true
			result.Calls = append(result.Calls, &runtimev1.IntegrationProviderCall{CallId: c.fact.CallId, TargetRef: c.target.Public.TargetRef, Operation: c.op.Name, InputJson: c.input, ConsumerDisplayName: c.fact.ConsumerDisplayName})
			if len(result.Calls) == 16 {
				break
			}
		}
		s.mu.Unlock()
		if len(result.Calls) > 0 || len(result.CanceledCallIds) > 0 || wait == 0 {
			return result, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-d.SessionInvalidated:
			return nil, failure(codes.PermissionDenied, "INTEGRATION_SCOPE_ENDED")
		case <-s.ctx.Done():
			return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
		case <-deadline.C:
			return result, nil
		case <-tick.C:
		}
	}
}
func (s *Service) CompleteIntegrationProvider(ctx context.Context, req *runtimev1.CompleteIntegrationProviderRequest) (*runtimev1.CompleteIntegrationProviderResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationProviderComplete)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	s.mu.Lock()
	c := s.calls[req.CallId]
	if c == nil || c.target.Account != d.AccountID || c.target.Subject != d.RegisteredAppSubject || c.providerSession != d.SessionID || !c.delivered || c.fact.Status != "accepted" || c.ctx.Err() != nil {
		s.mu.Unlock()
		return &runtimev1.CompleteIntegrationProviderResponse{Accepted: false}, nil
	}
	s.mu.Unlock()
	if !s.scopeLive(c.ctx, c.decision, localappop.IngressIntegrationCallInvoke) || !s.permitted(ctx, c.decision.AccountID, c.decision.RegisteredAppSubject, c.target.Public.TargetRef, c.op.Name) {
		s.cancelInvocation(c)
		return &runtimev1.CompleteIntegrationProviderResponse{Accepted: false}, nil
	}
	if req.ErrorCode != "" {
		if len(req.ErrorCode) > 128 {
			return nil, failure(codes.InvalidArgument, "INTEGRATION_ERROR_BOUNDS")
		}
		accepted := s.finishProvider(c, "failed", "", "PROVIDER_FAILED")
		return &runtimev1.CompleteIntegrationProviderResponse{Accepted: accepted}, nil
	}
	value, err := decodeJSON(req.ResultJson, maxOutput)
	if err != nil {
		return nil, err
	}
	if err := validateSchema(c.op.OutputSchemaJson, value); err != nil {
		return nil, err
	}
	accepted := s.finishProvider(c, "completed", req.ResultJson, "")
	return &runtimev1.CompleteIntegrationProviderResponse{Accepted: accepted}, nil
}

// The final result acceptance and cancellation mutation share one boundary;
// validation outside the mutex cannot grant a late result a second chance.
func (s *Service) finishProvider(c *invocation, state, result, reason string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() || c.ctx.Err() != nil || closed(c.decision.SessionInvalidated) || c.fact.Status != "accepted" {
		return false
	}
	p := s.providers[c.target.Public.TargetRef]
	if p == nil || p.decision.SessionID != c.providerSession || p.ctx.Err() != nil || closed(p.decision.SessionInvalidated) {
		return false
	}
	return s.finishLocked(c, state, result, reason)
}
