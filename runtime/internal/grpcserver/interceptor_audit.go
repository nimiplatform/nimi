package grpcserver

import (
	"context"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
)

func newUnaryAuditInterceptor(store *auditlog.Store) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if store == nil {
			return nil, status.Error(codes.Internal, "audit store is required")
		}
		startedAt := time.Now().UTC()
		handlerCtx, queueWaitRecorder := usagemetrics.WithQueueWaitRecorder(ctx)
		var (
			resp any
			err  error
		)
		if validationErr := validateAppIDConflict(handlerCtx, req); validationErr != nil {
			err = validationErr
		} else {
			resp, err = handler(handlerCtx, req)
		}

		domain, operation, capability := methodDescriptor(info.FullMethod)
		appID, subjectUserID, modelID := inferRequestIdentity(req)
		if appID == "" {
			appID = appIDFromMetadata(handlerCtx)
		}
		// K-AUDIT-018: prefer JWT subject_user_id over request body (WP-6)
		if identity := authn.IdentityFromContext(handlerCtx); identity != nil {
			subjectUserID = identity.SubjectUserID
		}
		callerKind, callerID, surfaceID, traceID := readCallerMetadata(handlerCtx)
		credentialSource, providerEndpoint, providerAPIKeyFingerprint := providerCredentialMetadata(handlerCtx)
		tokenID := accessTokenIDFromMetadata(handlerCtx)

		reasonCode := reasonCodeFromError(err)
		if reasonCode == runtimev1.ReasonCode_ACTION_EXECUTED {
			if rc, ok := inferReasonCodeFromResponse(resp); ok {
				reasonCode = rc
			}
		}
		success := reasonCode == runtimev1.ReasonCode_ACTION_EXECUTED

		if modelFromResp, ok := inferModelResolved(resp); ok && modelFromResp != "" {
			modelID = modelFromResp
		}
		usage, _ := inferUsage(resp)

		payload := map[string]any{
			"grpc_method":                  info.FullMethod,
			"model_id":                     modelID,
			"success":                      success,
			"kind":                         "unary",
			"credential_source":            credentialSource,
			"provider_endpoint":            providerEndpoint,
			"provider_api_key_fingerprint": providerAPIKeyFingerprint,
		}
		// request_id is set on the top-level AuditEventRecord.request_id field
		// (K-AUDIT-003 baseline request_id == trace_id) and mirrored into the AI
		// execution payload (K-AUDIT-018) for fan-out separation.
		requestID := addAIExecutionAuditPayload(payload, req, traceID, aiExecutionAuditContext{
			Provider:      providerIdentityFromMetadata(handlerCtx),
			RequestSource: requestSourceFromCallerKind(callerKind),
			ClientID:      appInstanceIDFromMetadata(handlerCtx),
			GRPCCode:      grpcCodeOnFailure(err, success),
		})
		appendAuditEvent(store, auditEventInput{
			AppID:         appID,
			SubjectUserID: subjectUserID,
			Domain:        domain,
			Operation:     operation,
			Capability:    capability,
			ReasonCode:    reasonCode,
			TraceID:       traceID,
			RequestID:     requestID,
			CallerKind:    callerKind,
			CallerID:      callerID,
			SurfaceID:     surfaceID,
			TokenID:       tokenID,
			PrincipalID:   principalID(callerID, tokenID),
			PrincipalType: principalType(callerKind, tokenID),
			Payload:       payload,
		})
		store.RecordUsage(auditlog.UsageInput{
			Timestamp:     startedAt,
			AppID:         appID,
			SubjectUserID: subjectUserID,
			CallerKind:    callerKind,
			CallerID:      callerID,
			Capability:    capability,
			ModelID:       modelID,
			Success:       success,
			Usage:         usage,
			QueueWaitMs:   queueWaitRecorder.Value(),
		})
		return resp, err
	}
}

func newStreamAuditInterceptor(store *auditlog.Store) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if store == nil {
			return status.Error(codes.Internal, "audit store is required")
		}
		startedAt := time.Now().UTC()
		_, queueWaitRecorder := usagemetrics.WithQueueWaitRecorder(ss.Context())
		wrapped := &auditStream{
			ServerStream:      ss,
			queueWaitRecorder: queueWaitRecorder,
		}
		err := handler(srv, wrapped)
		streamCtx := wrapped.Context()
		request, usage, modelResolved, traceID := wrapped.snapshot()

		domain, operation, capability := methodDescriptor(info.FullMethod)
		appID, subjectUserID, modelID := inferRequestIdentity(request)
		if appID == "" {
			appID = appIDFromMetadata(streamCtx)
		}
		// K-AUDIT-018: prefer JWT subject_user_id over request body (WP-6)
		if identity := authn.IdentityFromContext(streamCtx); identity != nil {
			subjectUserID = identity.SubjectUserID
		}
		if modelResolved != "" {
			modelID = modelResolved
		}
		callerKind, callerID, surfaceID, metadataTraceID := readCallerMetadata(ss.Context())
		credentialSource, providerEndpoint, providerAPIKeyFingerprint := providerCredentialMetadata(ss.Context())
		tokenID := accessTokenIDFromMetadata(ss.Context())
		if traceID == "" {
			traceID = metadataTraceID
		}

		reasonCode := reasonCodeFromError(err)
		success := reasonCode == runtimev1.ReasonCode_ACTION_EXECUTED

		payload := map[string]any{
			"grpc_method":                  info.FullMethod,
			"model_id":                     modelID,
			"success":                      success,
			"kind":                         "stream",
			"credential_source":            credentialSource,
			"provider_endpoint":            providerEndpoint,
			"provider_api_key_fingerprint": providerAPIKeyFingerprint,
		}
		// request_id is set on the top-level AuditEventRecord.request_id field
		// (K-AUDIT-003 baseline request_id == trace_id) and mirrored into the AI
		// execution payload (K-AUDIT-018) for fan-out separation.
		requestID := addAIExecutionAuditPayload(payload, request, traceID, aiExecutionAuditContext{
			Provider:      providerIdentityFromMetadata(ss.Context()),
			RequestSource: requestSourceFromCallerKind(callerKind),
			ClientID:      appInstanceIDFromMetadata(ss.Context()),
			GRPCCode:      grpcCodeOnFailure(err, success),
		})
		appendAuditEvent(store, auditEventInput{
			AppID:         appID,
			SubjectUserID: subjectUserID,
			Domain:        domain,
			Operation:     operation,
			Capability:    capability,
			ReasonCode:    reasonCode,
			TraceID:       traceID,
			RequestID:     requestID,
			CallerKind:    callerKind,
			CallerID:      callerID,
			SurfaceID:     surfaceID,
			TokenID:       tokenID,
			PrincipalID:   principalID(callerID, tokenID),
			PrincipalType: principalType(callerKind, tokenID),
			Payload:       payload,
		})
		store.RecordUsage(auditlog.UsageInput{
			Timestamp:     startedAt,
			AppID:         appID,
			SubjectUserID: subjectUserID,
			CallerKind:    callerKind,
			CallerID:      callerID,
			Capability:    capability,
			ModelID:       modelID,
			Success:       success,
			Usage:         usage,
			QueueWaitMs:   queueWaitRecorder.Value(),
		})
		return err
	}
}

type auditStream struct {
	grpc.ServerStream
	request           any
	usage             *runtimev1.UsageStats
	modelResolved     string
	traceID           string
	queueWaitRecorder *usagemetrics.QueueWaitRecorder
	mu                sync.RWMutex
}

func (s *auditStream) RecvMsg(m any) error {
	err := s.ServerStream.RecvMsg(m)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.request == nil {
		s.request = cloneAnyProto(m)
	}
	return nil
}

func (s *auditStream) Context() context.Context {
	return usagemetrics.WithExistingQueueWaitRecorder(s.ServerStream.Context(), s.queueWaitRecorder)
}

func (s *auditStream) SendMsg(m any) error {
	if err := s.ServerStream.SendMsg(m); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	switch msg := m.(type) {
	case *runtimev1.StreamScenarioEvent:
		if usage := msg.GetUsage(); usage != nil {
			s.usage = cloneUsage(usage)
		}
		if started := msg.GetStarted(); started != nil && started.GetModelResolved() != "" {
			s.modelResolved = started.GetModelResolved()
		}
		if completed := msg.GetCompleted(); completed != nil && completed.GetUsage() != nil {
			s.usage = cloneUsage(completed.GetUsage())
		}
		if msg.GetTraceId() != "" {
			s.traceID = msg.GetTraceId()
		}
	case *runtimev1.ArtifactChunk:
		if usage := msg.GetUsage(); usage != nil {
			s.usage = cloneUsage(usage)
		}
		if msg.GetModelResolved() != "" {
			s.modelResolved = msg.GetModelResolved()
		}
		if msg.GetTraceId() != "" {
			s.traceID = msg.GetTraceId()
		}
	case *runtimev1.ScenarioJobEvent:
		if job := msg.GetJob(); job != nil {
			if usage := job.GetUsage(); usage != nil {
				s.usage = cloneUsage(usage)
			}
			if job.GetModelResolved() != "" {
				s.modelResolved = job.GetModelResolved()
			}
		}
		if msg.GetTraceId() != "" {
			s.traceID = msg.GetTraceId()
		}
	}
	return nil
}

func (s *auditStream) snapshot() (any, *runtimev1.UsageStats, string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var request any
	if s.request != nil {
		request = cloneAnyProto(s.request)
	}

	return request, cloneUsage(s.usage), s.modelResolved, s.traceID
}
