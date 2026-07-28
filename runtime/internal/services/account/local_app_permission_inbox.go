package account

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) ListLocalAppPermissionRequests(ctx context.Context, req *runtimev1.ListLocalAppPermissionRequestsRequest) (*runtimev1.ListLocalAppPermissionRequestsResponse, error) {
	accountID, ok := s.authorizePermissionOwner(ctx, req.GetCaller())
	if !ok {
		return &runtimev1.ListLocalAppPermissionRequestsResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED}, nil
	}
	requests, err := s.permissionInboxRequests(ctx, accountID)
	if err != nil {
		return &runtimev1.ListLocalAppPermissionRequestsResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE}, nil
	}
	return &runtimev1.ListLocalAppPermissionRequestsResponse{Accepted: true, Requests: requests, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SubscribeLocalAppPermissionRequests(req *runtimev1.SubscribeLocalAppPermissionRequestsRequest, stream runtimev1.RuntimeAccountService_SubscribeLocalAppPermissionRequestsServer) error {
	accountID, ok := s.authorizePermissionOwner(stream.Context(), req.GetCaller())
	if !ok {
		return stream.Send(&runtimev1.LocalAppPermissionInboxEvent{Accepted: false, ReasonCode: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED})
	}
	s.permissionInboxMu.Lock()
	requests, err := s.permissionInboxRequests(stream.Context(), accountID)
	if err != nil {
		s.permissionInboxMu.Unlock()
		return stream.Send(&runtimev1.LocalAppPermissionInboxEvent{Accepted: false, ReasonCode: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE})
	}
	s.permissionInboxSequence++
	snapshot := &runtimev1.LocalAppPermissionInboxEvent{
		Sequence: s.permissionInboxSequence, EmittedAt: timestamppb.New(s.now().UTC()), Requests: requests,
		Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}
	s.nextPermissionInboxSubscriberID++
	subscriber := permissionInboxSubscriber{id: s.nextPermissionInboxSubscriberID, ch: make(chan *runtimev1.LocalAppPermissionInboxEvent, 16)}
	s.permissionInboxSubscribers[subscriber.id] = subscriber
	s.permissionInboxMu.Unlock()
	if err := stream.Send(snapshot); err != nil {
		s.removePermissionInboxSubscriber(subscriber.id)
		return err
	}
	defer s.removePermissionInboxSubscriber(subscriber.id)
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, open := <-subscriber.ch:
			if !open {
				return status.Error(codes.ResourceExhausted, "local-app permission inbox delivery gap")
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}
}

func (s *Service) authorizePermissionOwner(ctx context.Context, caller *runtimev1.AccountCaller) (string, bool) {
	if s == nil || s.localAppKernel == nil {
		return "", false
	}
	if reason, ok := s.validateRuntimeAccountControlCaller(ctx, caller); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		return "", false
	}
	projection, _, authenticated := s.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || projection.GetAccountId() == "" {
		return "", false
	}
	return projection.GetAccountId(), true
}

func (s *Service) permissionInboxRequests(ctx context.Context, accountID string) ([]*runtimev1.LocalAppPermissionPendingRequest, error) {
	requests, err := s.localAppKernel.PermissionGrants().ListPendingRequests(ctx, s.localAppKernel.LocalOSUserAnchor(), accountID)
	if err != nil {
		return nil, err
	}
	projected := make([]*runtimev1.LocalAppPermissionPendingRequest, 0, len(requests))
	for _, request := range requests {
		projected = append(projected, projectPendingPermissionRequest(request))
	}
	return projected, nil
}

func projectPendingPermissionRequest(request localappkernel.PermissionRequest) *runtimev1.LocalAppPermissionPendingRequest {
	return &runtimev1.LocalAppPermissionPendingRequest{
		LocalAppPrincipalId: request.LocalAppPrincipalID, DisplayAppId: request.DisplayAppID,
		PermissionId: request.PermissionID, Reason: request.Reason, RequestedAt: timestamppb.New(request.RequestedAt),
		OwnerRevision: request.Revision,
	}
}

func (s *Service) publishPermissionInbox(ctx context.Context, accountID string) {
	if s == nil || s.localAppKernel == nil || accountID == "" {
		return
	}
	requests, err := s.permissionInboxRequests(ctx, accountID)
	if err != nil {
		return
	}
	s.permissionInboxMu.Lock()
	defer s.permissionInboxMu.Unlock()
	if len(s.permissionInboxSubscribers) == 0 {
		return
	}
	s.permissionInboxSequence++
	event := &runtimev1.LocalAppPermissionInboxEvent{
		Sequence: s.permissionInboxSequence, EmittedAt: timestamppb.New(s.now().UTC()), Requests: requests,
		Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}
	for id, subscriber := range s.permissionInboxSubscribers {
		select {
		case subscriber.ch <- event:
		default:
			close(subscriber.ch)
			delete(s.permissionInboxSubscribers, id)
		}
	}
}

func (s *Service) removePermissionInboxSubscriber(id uint64) {
	s.permissionInboxMu.Lock()
	defer s.permissionInboxMu.Unlock()
	delete(s.permissionInboxSubscribers, id)
}
