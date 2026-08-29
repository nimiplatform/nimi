package runtimeagent

import (
	"context"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type runtimeAgentEmbodimentScopeResolver struct {
	svc       *Service
	ingress   localappop.Ingress
	operation accountservice.LocalAppOperation
}

func newRuntimeAgentEmbodimentScopeResolver(
	svc *Service,
	ingress localappop.Ingress,
	operation accountservice.LocalAppOperation,
) *runtimeAgentEmbodimentScopeResolver {
	return &runtimeAgentEmbodimentScopeResolver{svc: svc, ingress: ingress, operation: operation}
}

func (r *runtimeAgentEmbodimentScopeResolver) ResolveLocalAppEmbodimentScope(
	ctx context.Context,
	req localAppEmbodimentReadRequest,
) (localAppEmbodimentScope, error) {
	if !r.valid() {
		return localAppEmbodimentScope{}, errLocalAppEmbodimentUnavailable
	}
	resolved, _, err := r.svc.resolveLocalAppAgent(ctx, r.operation, req.AgentHandle)
	if err != nil {
		return localAppEmbodimentScope{}, err
	}
	if err := r.svc.validateLocalAppConversationResource(resolved, req.ConversationAnchorID); err != nil {
		return localAppEmbodimentScope{}, err
	}
	return localAppEmbodimentScope{
		localAgentRef:        resolved.identity.LocalAgentRef,
		conversationAnchorID: req.ConversationAnchorID,
	}, nil
}

func (r *runtimeAgentEmbodimentScopeResolver) RevalidateLocalAppEmbodimentScope(
	ctx context.Context,
	req localAppEmbodimentReadRequest,
	scope localAppEmbodimentScope,
) error {
	if !r.valid() || validateLocalAppEmbodimentScope(scope, req.ConversationAnchorID) != nil {
		return localAppAgentAccessDenied()
	}
	ownerCtx, err := r.svc.localAppIngressRevalidator.AuthorizeLocalAppIngress(ctx, r.ingress)
	if err != nil {
		return err
	}
	resolved, _, err := r.svc.resolveLocalAppAgent(ownerCtx, r.operation, req.AgentHandle)
	if err != nil {
		return err
	}
	if resolved.identity.LocalAgentRef != scope.localAgentRef {
		return localAppAgentAccessDenied()
	}
	return r.svc.validateLocalAppConversationResource(resolved, req.ConversationAnchorID)
}

func (r *runtimeAgentEmbodimentScopeResolver) valid() bool {
	if r == nil || r.svc == nil || r.svc.localAppIngressRevalidator == nil {
		return false
	}
	switch {
	case r.ingress == localappop.IngressAgentEmbodimentSnapshotGet &&
		r.operation == accountservice.LocalAppOperationEmbodimentSnapshot:
		return true
	case r.ingress == localappop.IngressAgentEmbodimentEventsSubscribe &&
		r.operation == accountservice.LocalAppOperationEmbodimentEventsSubscribe:
		return true
	default:
		return false
	}
}

func (s *Service) localAppEmbodimentReadOwner(
	ingress localappop.Ingress,
	operation accountservice.LocalAppOperation,
) *localAppEmbodimentReadOwner {
	return newLocalAppEmbodimentReadOwner(
		newRuntimeAgentEmbodimentScopeResolver(s, ingress, operation),
		newRuntimeAgentEmbodimentSemanticOwner(s),
	)
}

// @nimi-authority: definition.nimi.platform.core-protocol.app-operation-contract
// @nimi-authority: rule.nimi.runtime.agent-participation.r159
func (s *Service) GetLocalAppEmbodimentSnapshot(
	ctx context.Context,
	req *runtimev1.GetLocalAppEmbodimentSnapshotRequest,
) (*runtimev1.GetLocalAppEmbodimentSnapshotResponse, error) {
	if req == nil {
		return nil, localAppEmbodimentRPCError(errLocalAppEmbodimentInvalidInput)
	}
	snapshot, err := s.localAppEmbodimentReadOwner(
		localappop.IngressAgentEmbodimentSnapshotGet,
		accountservice.LocalAppOperationEmbodimentSnapshot,
	).Snapshot(ctx, localAppEmbodimentReadRequest{
		AgentHandle:          req.GetAgentHandle(),
		ConversationAnchorID: req.GetConversationAnchorId(),
	})
	if err != nil {
		return nil, localAppEmbodimentRPCError(err)
	}
	projected, err := localAppEmbodimentSnapshotToProto(snapshot)
	if err != nil {
		return nil, localAppEmbodimentRPCError(err)
	}
	return &runtimev1.GetLocalAppEmbodimentSnapshotResponse{Snapshot: projected}, nil
}

// @nimi-authority: definition.nimi.platform.core-protocol.app-operation-contract
// @nimi-authority: rule.nimi.runtime.agent-participation.r159
func (s *Service) SubscribeLocalAppEmbodimentEvents(
	req *runtimev1.SubscribeLocalAppEmbodimentEventsRequest,
	stream runtimev1.RuntimeAgentService_SubscribeLocalAppEmbodimentEventsServer,
) error {
	if req == nil || stream == nil {
		return localAppEmbodimentRPCError(errLocalAppEmbodimentInvalidInput)
	}
	err := s.localAppEmbodimentReadOwner(
		localappop.IngressAgentEmbodimentEventsSubscribe,
		accountservice.LocalAppOperationEmbodimentEventsSubscribe,
	).SubscribeEstablished(stream.Context(), localAppEmbodimentSubscribeRequest{
		localAppEmbodimentReadRequest: localAppEmbodimentReadRequest{
			AgentHandle:          req.GetAgentHandle(),
			ConversationAnchorID: req.GetConversationAnchorId(),
		},
		AfterSequence: req.GetAfterSequence(),
	}, func() error {
		return stream.SendHeader(metadata.MD{})
	}, func(event localAppEmbodimentEvent) error {
		projected, err := localAppEmbodimentEventToProto(event)
		if err != nil {
			return err
		}
		return stream.Send(projected)
	})
	if errors.Is(err, context.Canceled) && stream.Context().Err() != nil {
		return nil
	}
	return localAppEmbodimentRPCError(err)
}

func localAppEmbodimentRPCError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return status.FromContextError(err).Err()
	}
	if _, ok := status.FromError(err); ok {
		return err
	}
	switch {
	case errors.Is(err, errLocalAppEmbodimentInvalidInput):
		return grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{},
		)
	case errors.Is(err, errLocalAppEmbodimentCursorExpired):
		return grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{},
		)
	default:
		return grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{},
		)
	}
}
