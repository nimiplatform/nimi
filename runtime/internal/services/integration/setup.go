package integration

import (
	"context"
	"database/sql"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type connectionSetup struct {
	decision           accountservice.LocalAppCallerDecision
	request            *runtimev1.PutIntegrationConnectionRequest
	view               *runtimev1.IntegrationConnectionSetup
	cancel             context.CancelFunc
	codes              chan string
	newTargetDecision  chan struct{}
	weixinRefresh      *weixinSetupRefresh
	weixinAlreadyBound bool
}

func activeSetupStatus(status string) bool {
	return status == "awaiting-input" || status == "awaiting-confirmation" || status == "awaiting-new-target" || status == "verifying"
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func publicSetupError(err error) string {
	// An asynchronous setup returns a normal failed view, not an RPC failure.
	// Preserve only the closed owner reasons valid for that ErrorInfo owner;
	// never parse a status message or a provider response to recover a reason.
	reason, typed := grpcerr.ExtractReasonCode(err)
	metadata, _ := grpcerr.ExtractReasonMetadata(err)
	if typed {
		switch reason {
		case runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE:
			switch metadata["integration_reason"] {
			case "INTEGRATION_NEW_TARGET_REQUIRED", "INTEGRATION_IDENTITY_ALREADY_CONNECTED",
				"INTEGRATION_CONFIGURATION_CHANGED", "INTEGRATION_CONFIGURATION_INVALID",
				"INTEGRATION_INPUT_INVALID", "INTEGRATION_TARGET_NOT_FOUND",
				"INTEGRATION_MANAGEMENT_DENIED", "INTEGRATION_SCOPE_ENDED",
				"INTEGRATION_SETUP_EXPIRED", "INTEGRATION_SETUP_STOPPED",
				"INTEGRATION_QQ_SECRET_REQUIRED", "INTEGRATION_FEISHU_SETUP_REQUIRED",
				"INTEGRATION_FEISHU_IDENTITY_INVALID", "INTEGRATION_ONEBOT_AUTH_REQUIRED",
				"INTEGRATION_ONEBOT_IDENTITY_INVALID", "INTEGRATION_WEIXIN_SETUP_REQUIRED",
				"INTEGRATION_WEIXIN_CREDENTIAL_INVALID", "INTEGRATION_WEIXIN_ENDPOINT_INVALID",
				"INTEGRATION_TELEGRAM_CONFIGURATION_INVALID", "INTEGRATION_TELEGRAM_IDENTITY_INVALID",
				"INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT", "INTEGRATION_TELEGRAM_VERIFICATION_REQUIRED",
				"INTEGRATION_SCHEMA_INVALID", "INTEGRATION_OPERATIONS_BOUNDS":
				return metadata["integration_reason"]
			}
		case runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE:
			switch metadata["integration_reason"] {
			case "INTEGRATION_ADAPTER_NOT_READY", "INTEGRATION_AUDIT_UNAVAILABLE",
				"INTEGRATION_CREDENTIAL_UNAVAILABLE", "INTEGRATION_CUSTODY_UNAVAILABLE",
				"INTEGRATION_TARGET_UNAVAILABLE", "INTEGRATION_UNAVAILABLE",
				"INTEGRATION_NETWORK_FAILED", "INTEGRATION_TIMEOUT", "INTEGRATION_CANCELED",
				"INTEGRATION_REQUEST_INVALID", "INTEGRATION_RESPONSE_INVALID",
				"INTEGRATION_ENDPOINT_INVALID", "INTEGRATION_DISCOVERY_FAILED",
				"INTEGRATION_PROVIDER_REJECTED", "INTEGRATION_CREDENTIAL_EXPIRED", "INTEGRATION_RATE_LIMITED",
				"INTEGRATION_QQ_AUTH_REJECTED", "INTEGRATION_QQ_GATEWAY_INVALID",
				"INTEGRATION_QQ_REQUEST_REJECTED", "INTEGRATION_QQ_RESPONSE_INVALID", "INTEGRATION_QQ_RESPONSE_UNCONFIRMED",
				"INTEGRATION_FEISHU_REQUEST_FAILED", "INTEGRATION_FEISHU_PROVIDER_REJECTED",
				"INTEGRATION_FEISHU_RESPONSE_INVALID", "INTEGRATION_FEISHU_IDENTITY_INVALID",
				"INTEGRATION_ONEBOT_IDENTITY_INVALID", "INTEGRATION_ONEBOT_TRANSPORT_PROTECTION_REQUIRED",
				"INTEGRATION_ONEBOT_LISTENER_LIMIT", "INTEGRATION_ONEBOT_LISTENER_BUSY",
				"INTEGRATION_ONEBOT_BUSY", "INTEGRATION_ONEBOT_CONNECTION_TIMEOUT",
				"INTEGRATION_ONEBOT_DISCONNECTED", "INTEGRATION_ONEBOT_ROLE_INVALID",
				"INTEGRATION_ONEBOT_IMPLEMENTATION_CHANGED", "INTEGRATION_ONEBOT_VERSION_INVALID",
				"INTEGRATION_ONEBOT_REQUEST_REJECTED", "INTEGRATION_ONEBOT_RESPONSE_INVALID",
				"INTEGRATION_ONEBOT_RESPONSE_UNCONFIRMED", "INTEGRATION_ONEBOT_RESULT_UNCONFIRMED",
				"INTEGRATION_ONEBOT_FRAME_INVALID", "INTEGRATION_ONEBOT_FRAME_BOUNDS",
				"INTEGRATION_RECEIVER_DRAINING":
				return metadata["integration_reason"]
			}
		}
		return "INTEGRATION_EXECUTOR_FAILED"
	}
	return publicAdapterError(err)
}

func (s *Service) setupLocked(d accountservice.LocalAppCallerDecision, id string) (*connectionSetup, error) {
	setup := s.setups[id]
	if setup == nil || !sameScope(setup.decision, d) {
		return nil, failure(codes.NotFound, "INTEGRATION_SETUP_NOT_FOUND")
	}
	if !time.Now().Before(setup.view.ExpiresAt.AsTime()) || closed(setup.decision.SessionInvalidated) || s.closed || s.quiesced.Load() {
		if activeSetupStatus(setup.view.Status) {
			setup.view.Status = "expired"
			setup.view.VerificationUrl = ""
			setup.view.QrCodeUrl = ""
			if setup.cancel != nil {
				setup.cancel()
			}
		}
	}
	return setup, nil
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
func (s *Service) StartIntegrationConnectionSetup(ctx context.Context, req *runtimev1.StartIntegrationConnectionSetupRequest) (_ *runtimev1.StartIntegrationConnectionSetupResponse, err error) {
	record := s.beginAudit(ctx, "integration.connection.setup.start")
	defer func() { record.finish(err) }()
	d, err := s.management(ctx, localappop.OperationIntegrationConnectionSetupStart)
	if err != nil {
		return nil, err
	}
	record.bind(d)
	if req == nil || !validConnectionDisplayName(req.Adapter, req.DisplayName) || len(req.AccountLabel) > 256 {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	if err := validateConnectionConfig(req.Adapter, req.Config); err != nil {
		return nil, err
	}
	// No unimplemented adapter may create an apparently usable connection.
	if s.adapters[req.Adapter].configure == nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_ADAPTER_NOT_READY")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	active := 0
	oldestTerminal := ""
	for id, setup := range s.setups {
		if !time.Now().Before(setup.view.ExpiresAt.AsTime()) {
			if setup.cancel != nil {
				setup.cancel()
			}
			delete(s.setups, id)
			continue
		}
		if activeSetupStatus(setup.view.Status) && sameScope(d, setup.decision) {
			active++
		}
		if !activeSetupStatus(setup.view.Status) && (oldestTerminal == "" || id < oldestTerminal) {
			oldestTerminal = id
		}
	}
	if active >= 4 || (len(s.setups) >= 128 && oldestTerminal == "") {
		return nil, failure(codes.ResourceExhausted, "INTEGRATION_SETUP_LIMIT")
	}
	if len(s.setups) >= 128 {
		delete(s.setups, oldestTerminal)
	}
	if req.TargetRef != "" {
		old, e := s.loadTarget(ctx, d.AccountID, req.TargetRef)
		if e != nil {
			return nil, e
		}
		if old.Public.Kind != req.Adapter || !proto.Equal(old.Config, req.Config) {
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
		}
	}
	expiry := time.Now().Add(10 * time.Minute)
	if d.ExpiresAt.Before(expiry) {
		expiry = d.ExpiresAt
	}
	view := &runtimev1.IntegrationConnectionSetup{SetupId: "iset_" + ulid.Make().String(), Adapter: req.Adapter, TargetRef: req.TargetRef, Status: "awaiting-input", ExpiresAt: timestamppb.New(expiry)}
	s.setups[view.SetupId] = &connectionSetup{decision: d, request: &runtimev1.PutIntegrationConnectionRequest{TargetRef: req.TargetRef, Adapter: req.Adapter, DisplayName: req.DisplayName, AccountLabel: req.AccountLabel, Config: proto.Clone(req.Config).(*runtimev1.IntegrationConnectionConfig)}, view: view}
	if req.Adapter == "weixin" || (req.Adapter == "feishu" && req.Config.Feishu.SetupMode == "create") {
		setup := s.setups[view.SetupId]
		setup.codes = make(chan string, 1)
		if req.Adapter == "weixin" && req.TargetRef != "" {
			setup.newTargetDecision = make(chan struct{}, 1)
		}
		s.launchSetupLocked(ctx, setup, "")
	}
	return &runtimev1.StartIntegrationConnectionSetupResponse{Setup: proto.Clone(view).(*runtimev1.IntegrationConnectionSetup)}, nil
}

func (s *Service) GetIntegrationConnectionSetup(ctx context.Context, req *runtimev1.GetIntegrationConnectionSetupRequest) (*runtimev1.GetIntegrationConnectionSetupResponse, error) {
	d, err := s.management(ctx, localappop.OperationIntegrationConnectionSetupGet)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	setup, err := s.setupLocked(d, req.GetSetupId())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetIntegrationConnectionSetupResponse{Setup: proto.Clone(setup.view).(*runtimev1.IntegrationConnectionSetup)}, nil
}

func (s *Service) SubmitIntegrationConnectionSetup(ctx context.Context, req *runtimev1.SubmitIntegrationConnectionSetupRequest) (_ *runtimev1.SubmitIntegrationConnectionSetupResponse, err error) {
	record := s.beginAudit(ctx, "integration.connection.setup.submit")
	defer func() { record.finish(err) }()
	d, err := s.management(ctx, localappop.OperationIntegrationConnectionSetupSubmit)
	if err != nil {
		return nil, err
	}
	record.bind(d)
	if req == nil || len(req.Secret) > 16384 || len(req.VerificationCode) > 32 {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	if req.Action != runtimev1.IntegrationConnectionSetupAction_INTEGRATION_CONNECTION_SETUP_ACTION_UNSPECIFIED && req.Action != runtimev1.IntegrationConnectionSetupAction_INTEGRATION_CONNECTION_SETUP_ACTION_CREATE_NEW_TARGET {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	setup, err := s.setupLocked(d, req.SetupId)
	if err != nil {
		return nil, err
	}
	if req.Action == runtimev1.IntegrationConnectionSetupAction_INTEGRATION_CONNECTION_SETUP_ACTION_CREATE_NEW_TARGET {
		if req.Secret != "" || req.VerificationCode != "" {
			return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
		}
		if setup.view.Status != "awaiting-new-target" || setup.weixinRefresh == nil || setup.newTargetDecision == nil {
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_SETUP_NOT_AWAITING_INPUT")
		}
		if err := s.commitManagementLocked(ctx, d, localappop.IngressIntegrationConnectionSetupSubmit, func(commitCtx context.Context) error {
			if err := s.checkWeixinSetupRefresh(commitCtx, setup); err != nil {
				return err
			}
			record.set("disposition", "create-new-target")
			record.set("target_ref", setup.request.TargetRef)
			if err := s.backend.WriteTx(commitCtx, func(tx *sql.Tx) error { return record.commitTx(commitCtx, tx) }); err != nil {
				return s.auditUnavailable(err)
			}
			record.committed()
			select {
			case setup.newTargetDecision <- struct{}{}:
				setup.view.Status = "verifying"
				return nil
			default:
				return failure(codes.FailedPrecondition, "INTEGRATION_SETUP_NOT_AWAITING_INPUT")
			}
		}); err != nil {
			return nil, err
		}
		return &runtimev1.SubmitIntegrationConnectionSetupResponse{Setup: proto.Clone(setup.view).(*runtimev1.IntegrationConnectionSetup)}, nil
	}
	if setup.view.Status != "awaiting-input" {
		return nil, failure(codes.FailedPrecondition, "INTEGRATION_SETUP_NOT_AWAITING_INPUT")
	}
	if setup.codes != nil {
		if req.Secret != "" || req.VerificationCode == "" {
			return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
		}
		for _, character := range req.VerificationCode {
			if character < '0' || character > '9' {
				return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
			}
		}
		select {
		case setup.codes <- req.VerificationCode:
		default:
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_SETUP_NOT_AWAITING_INPUT")
		}
		setup.view.Status = "awaiting-confirmation"
		return &runtimev1.SubmitIntegrationConnectionSetupResponse{Setup: proto.Clone(setup.view).(*runtimev1.IntegrationConnectionSetup)}, nil
	}
	if req.VerificationCode != "" {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	s.launchSetupLocked(ctx, setup, req.Secret)
	return &runtimev1.SubmitIntegrationConnectionSetupResponse{Setup: proto.Clone(setup.view).(*runtimev1.IntegrationConnectionSetup)}, nil
}

func (s *Service) launchSetupLocked(ctx context.Context, setup *connectionSetup, secret string) {
	d := setup.decision
	work, cancel := context.WithDeadline(context.WithoutCancel(ctx), setup.view.ExpiresAt.AsTime())
	setup.cancel = cancel
	setup.view.Status = "verifying"
	input := proto.Clone(setup.request).(*runtimev1.PutIntegrationConnectionRequest)
	input.Secret = secret
	s.workers.Add(2)
	go func() {
		defer s.workers.Done()
		select {
		case <-work.Done():
		case <-d.SessionInvalidated:
			cancel()
		case <-s.ctx.Done():
			cancel()
		}
	}()
	go func() {
		defer s.workers.Done()
		defer cancel()
		audit := s.beginAudit(work, "integration.connection.setup.commit")
		audit.bind(d)
		var e error
		if setup.codes != nil {
			switch input.Adapter {
			case "weixin":
				input, e = s.prepareWeixinSetup(work, setup, input)
			case "feishu":
				input, e = s.prepareFeishuSetup(work, setup, input)
			}
		}
		if e == nil {
			s.mu.Lock()
			if !activeSetupStatus(setup.view.Status) || work.Err() != nil {
				e = failure(codes.Canceled, "INTEGRATION_SETUP_STOPPED")
			} else {
				setup.view.Status = "verifying"
			}
			s.mu.Unlock()
		}
		guard := func(commit func(context.Context) error) error {
			if setup.view.Status != "verifying" || work.Err() != nil || !time.Now().Before(setup.view.ExpiresAt.AsTime()) {
				return failure(codes.Canceled, "INTEGRATION_SETUP_STOPPED")
			}
			return s.commitManagementLocked(work, d, localappop.IngressIntegrationConnectionSetupSubmit, func(commitCtx context.Context) error {
				if e := s.checkWeixinSetupRefresh(commitCtx, setup); e != nil {
					return e
				}
				return commit(commitCtx)
			})
		}
		if e == nil && setup.weixinAlreadyBound {
			s.mu.Lock()
			e = guard(func(commitCtx context.Context) error {
				if setup.weixinRefresh == nil {
					return adapterError("INTEGRATION_WEIXIN_NEW_CONFIRMATION_REQUIRED")
				}
				audit.set("disposition", "already-bound")
				audit.set("target_ref", setup.request.TargetRef)
				if err := s.backend.WriteTx(commitCtx, func(tx *sql.Tx) error { return audit.commitTx(commitCtx, tx) }); err != nil {
					return s.auditUnavailable(err)
				}
				audit.committed()
				setup.view.Status = "already-bound"
				setup.view.AccountLabel = setup.weixinRefresh.target.Public.AccountLabel
				setup.view.QrCodeUrl = ""
				setup.view.VerificationUrl = ""
				return nil
			})
			s.mu.Unlock()
		} else if e == nil {
			commitWork := work
			if input.Adapter == "weixin" {
				commitWork = context.WithValue(work, verifiedWeixinSetupKey{}, true)
			}
			_, e = s.putConnection(commitWork, d, input, audit, guard, func(t target) {
				setup.view.Status = "completed"
				setup.view.TargetRef = t.Public.TargetRef
				setup.view.AccountLabel = t.Public.AccountLabel
				setup.view.QrCodeUrl = ""
				setup.view.VerificationUrl = ""
			})
		}
		audit.finish(e)
		s.mu.Lock()
		defer s.mu.Unlock()
		if e != nil && activeSetupStatus(setup.view.Status) {
			setup.view.Status = "failed"
			setup.view.ErrorCode = publicSetupError(e)
			if !time.Now().Before(setup.view.ExpiresAt.AsTime()) || setup.view.ErrorCode == "INTEGRATION_SETUP_EXPIRED" {
				setup.view.Status = "expired"
				setup.view.ErrorCode = "INTEGRATION_SETUP_EXPIRED"
			} else if work.Err() != nil || closed(d.SessionInvalidated) {
				setup.view.Status = "canceled"
				setup.view.ErrorCode = "INTEGRATION_SETUP_STOPPED"
			}
			setup.view.VerificationUrl = ""
			setup.view.QrCodeUrl = ""
		}
	}()
}

// Safe setup views are published under the same current-account/session fence
// as the final connection commit. Private polling state stays on its worker.
func (s *Service) publishSetup(ctx context.Context, setup *connectionSetup, update func()) error {
	return s.publishSetupChecked(ctx, setup, nil, update)
}

func (s *Service) publishSetupChecked(ctx context.Context, setup *connectionSetup, check func(context.Context) error, update func()) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !activeSetupStatus(setup.view.Status) || ctx.Err() != nil || !time.Now().Before(setup.view.ExpiresAt.AsTime()) {
		return failure(codes.Canceled, "INTEGRATION_SETUP_STOPPED")
	}
	return s.commitManagementLocked(ctx, setup.decision, localappop.IngressIntegrationConnectionSetupSubmit, func(commitCtx context.Context) error {
		if check != nil {
			if err := check(commitCtx); err != nil {
				return err
			}
		}
		update()
		return nil
	})
}

func (s *Service) CancelIntegrationConnectionSetup(ctx context.Context, req *runtimev1.CancelIntegrationConnectionSetupRequest) (_ *runtimev1.CancelIntegrationConnectionSetupResponse, err error) {
	record := s.beginAudit(ctx, "integration.connection.setup.cancel")
	defer func() { record.finish(err) }()
	d, err := s.management(ctx, localappop.OperationIntegrationConnectionSetupCancel)
	if err != nil {
		return nil, err
	}
	record.bind(d)
	s.mu.Lock()
	defer s.mu.Unlock()
	setup, err := s.setupLocked(d, req.GetSetupId())
	if err != nil {
		return nil, err
	}
	if activeSetupStatus(setup.view.Status) {
		setup.view.Status = "canceled"
		setup.view.VerificationUrl = ""
		setup.view.QrCodeUrl = ""
		if setup.cancel != nil {
			setup.cancel()
		}
	}
	return &runtimev1.CancelIntegrationConnectionSetupResponse{Setup: proto.Clone(setup.view).(*runtimev1.IntegrationConnectionSetup)}, nil
}

func (s *Service) commitManagementLocked(ctx context.Context, d accountservice.LocalAppCallerDecision, ingress localappop.Ingress, commit func(context.Context) error) error {
	if s.revalidator == nil {
		return failure(codes.PermissionDenied, "INTEGRATION_MANAGEMENT_DENIED")
	}
	return s.backend.WithSerializedWriter(ctx, func(writerCtx context.Context) error {
		return s.revalidator.CommitLocalAppIngress(writerCtx, ingress, func(current context.Context) error {
			next, ok := accountservice.AuthorizedLocalAppDecisionFromContext(current)
			if !ok || !sameScope(d, next) || closed(d.SessionInvalidated) || ctx.Err() != nil || !time.Now().Before(d.ExpiresAt) || s.desktop == nil || !s.desktop(current) || next.AppID != "nimi.desktop" || next.TrustClass != accountservice.LocalAppTrustClassBuiltIn {
				return failure(codes.PermissionDenied, "INTEGRATION_MANAGEMENT_DENIED")
			}
			return commit(current)
		})
	})
}
