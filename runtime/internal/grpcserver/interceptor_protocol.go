package grpcserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/idempotency"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
)

func newUnaryProtocolInterceptor(store *idempotency.Store) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		requireIdempotency := isWriteMethod(info.FullMethod)
		meta, err := envelope.Validate(ctx, req, requireIdempotency)
		if err != nil {
			return nil, err
		}

		if requireIdempotency && store != nil {
			appID := strings.TrimSpace(meta.AppID)
			if appID == "" {
				appID = appIDFromRequest(req)
			}
			requestHash, hashErr := hashRequest(req)
			if hashErr != nil {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			if replay, hit, conflict := store.Load(info.FullMethod, appID, meta.ParticipantID, meta.IdempotencyKey, requestHash); conflict {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			} else if hit {
				return replay, nil
			}

			resp, callErr := handler(ctx, req)
			if callErr == nil {
				if message, ok := resp.(proto.Message); ok && message != nil {
					store.Save(info.FullMethod, appID, meta.ParticipantID, meta.IdempotencyKey, requestHash, message)
				}
			}
			return resp, callErr
		}

		return handler(ctx, req)
	}
}

func newStreamProtocolInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		requireIdempotency := isWriteMethod(info.FullMethod)
		meta, err := envelope.Validate(ss.Context(), nil, requireIdempotency)
		if err != nil {
			return err
		}
		wrapped := &protocolStream{
			ServerStream:   ss,
			metadataAppID:  strings.TrimSpace(meta.AppID),
			checkedRequest: false,
		}
		return handler(srv, wrapped)
	}
}

type protocolStream struct {
	grpc.ServerStream
	metadataAppID  string
	checkedRequest bool
	mu             sync.Mutex
}

func (s *protocolStream) RecvMsg(m any) error {
	if err := s.ServerStream.RecvMsg(m); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.checkedRequest {
		return nil
	}
	s.checkedRequest = true
	if s.metadataAppID == "" {
		return nil
	}
	requestAppID := appIDFromRequest(m)
	if requestAppID == "" {
		return nil
	}
	if requestAppID != s.metadataAppID {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT)
	}
	return nil
}

func hashRequest(req any) (string, error) {
	msg, ok := req.(proto.Message)
	if !ok || msg == nil {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(msg)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func isWriteMethod(fullMethod string) bool {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/DeleteVoiceAsset",
		"/nimi.runtime.v1.RuntimeAiService/UploadArtifact",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/OpenRealtimeSession",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/AppendRealtimeInput",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/CloseRealtimeSession",
		"/nimi.runtime.v1.RuntimeWorkflowService/SubmitWorkflow",
		"/nimi.runtime.v1.RuntimeWorkflowService/CancelWorkflow",
		"/nimi.runtime.v1.RuntimeModelService/PullModel",
		"/nimi.runtime.v1.RuntimeModelService/RemoveModel",
		"/nimi.runtime.v1.RuntimeGrantService/AuthorizeExternalPrincipal",
		"/nimi.runtime.v1.RuntimeGrantService/RevokeAppAccessToken",
		"/nimi.runtime.v1.RuntimeGrantService/IssueDelegatedAccessToken",
		"/nimi.runtime.v1.RuntimeAuthService/RegisterApp",
		"/nimi.runtime.v1.RuntimeAuthService/OpenSession",
		"/nimi.runtime.v1.RuntimeAuthService/RefreshSession",
		"/nimi.runtime.v1.RuntimeAuthService/RevokeSession",
		"/nimi.runtime.v1.RuntimeAuthService/RegisterExternalPrincipal",
		"/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAuthService/RevokeExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAccountService/BeginLogin",
		"/nimi.runtime.v1.RuntimeAccountService/CompleteLogin",
		"/nimi.runtime.v1.RuntimeAccountService/GetAccessToken",
		"/nimi.runtime.v1.RuntimeAccountService/RefreshAccountSession",
		"/nimi.runtime.v1.RuntimeAccountService/Logout",
		"/nimi.runtime.v1.RuntimeAccountService/SwitchAccount",
		"/nimi.runtime.v1.RuntimeAccountService/IssueScopedAppBinding",
		"/nimi.runtime.v1.RuntimeAccountService/RevokeScopedAppBinding",
		"/nimi.runtime.v1.RuntimeCognitionService/CreateBank",
		"/nimi.runtime.v1.RuntimeCognitionService/DeleteBank",
		"/nimi.runtime.v1.RuntimeCognitionService/Retain",
		"/nimi.runtime.v1.RuntimeCognitionService/DeleteMemory",
		"/nimi.runtime.v1.RuntimeCognitionService/CreateKnowledgeBank",
		"/nimi.runtime.v1.RuntimeCognitionService/DeleteKnowledgeBank",
		"/nimi.runtime.v1.RuntimeCognitionService/PutPage",
		"/nimi.runtime.v1.RuntimeCognitionService/DeletePage",
		"/nimi.runtime.v1.RuntimeCognitionService/AddLink",
		"/nimi.runtime.v1.RuntimeCognitionService/RemoveLink",
		"/nimi.runtime.v1.RuntimeCognitionService/IngestDocument",
		"/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
		"/nimi.runtime.v1.RuntimeLocalService/InstallVerifiedAsset",
		"/nimi.runtime.v1.RuntimeLocalService/ImportLocalAsset",
		"/nimi.runtime.v1.RuntimeLocalService/RemoveLocalAsset",
		"/nimi.runtime.v1.RuntimeLocalService/StartLocalAsset",
		"/nimi.runtime.v1.RuntimeLocalService/StopLocalAsset",
		"/nimi.runtime.v1.RuntimeLocalService/WarmLocalAsset",
		"/nimi.runtime.v1.RuntimeLocalService/ApplyProfile",
		"/nimi.runtime.v1.RuntimeLocalService/InstallLocalService",
		"/nimi.runtime.v1.RuntimeLocalService/StartLocalService",
		"/nimi.runtime.v1.RuntimeLocalService/StopLocalService",
		"/nimi.runtime.v1.RuntimeLocalService/RemoveLocalService",
		"/nimi.runtime.v1.RuntimeLocalService/AppendInferenceAudit",
		"/nimi.runtime.v1.RuntimeLocalService/AppendRuntimeAudit",
		"/nimi.runtime.v1.RuntimeLocalService/EnsureEngine",
		"/nimi.runtime.v1.RuntimeLocalService/StartEngine",
		"/nimi.runtime.v1.RuntimeLocalService/StopEngine",
		"/nimi.runtime.v1.RuntimeConnectorService/CreateConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/UpdateConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/DeleteConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/TestConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/UpsertModelCatalogProvider",
		"/nimi.runtime.v1.RuntimeConnectorService/DeleteModelCatalogProvider",
		"/nimi.runtime.v1.RuntimeConnectorService/UpsertCatalogModelOverlay",
		"/nimi.runtime.v1.RuntimeConnectorService/DeleteCatalogModelOverlay",
		"/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":
		return true
	default:
		return false
	}
}
