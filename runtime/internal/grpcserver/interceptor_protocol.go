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
		ctx = envelope.WithMetadata(ctx, meta)

		if requireIdempotency && store != nil && !usesDomainDurableIdempotency(info.FullMethod) {
			appID := strings.TrimSpace(meta.AppID)
			if appID == "" {
				appID = appIDFromRequest(req)
			}
			requestHash, hashErr := hashRequest(req)
			if hashErr != nil {
				return nil, hashErr
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

// Materialization request/replay truth is durable domain state. The protocol
// envelope still requires an idempotency key, but the process-local generic
// response cache must never bypass Packet acquisition, verification, replay,
// or atomic product lifecycle checks.
func usesDomainDurableIdempotency(fullMethod string) bool {
	return fullMethod == "/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource"
}

func newStreamProtocolInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		meta, err := envelope.Validate(ss.Context(), nil, false)
		if err != nil {
			return err
		}
		wrapped := &protocolStream{
			ServerStream:   ss,
			ctx:            envelope.WithMetadata(ss.Context(), meta),
			metadataAppID:  strings.TrimSpace(meta.AppID),
			checkedRequest: false,
		}
		return handler(srv, wrapped)
	}
}

type protocolStream struct {
	grpc.ServerStream
	ctx            context.Context
	metadataAppID  string
	checkedRequest bool
	mu             sync.Mutex
}

func (s *protocolStream) Context() context.Context {
	if s.ctx == nil {
		return s.ServerStream.Context()
	}
	return s.ctx
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
		return "", grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{
				ActionHint: "fix_request_envelope",
				Message:    "request envelope could not be encoded",
			},
		)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func isWriteMethod(fullMethod string) bool {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig",
		"/nimi.runtime.v1.RuntimeAiService/GenerateLocalAppTextCandidate",
		"/nimi.runtime.v1.RuntimeAiService/ExecuteLocalAppScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitLocalAppScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelLocalAppScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/UploadLocalAppArtifact",
		"/nimi.runtime.v1.RuntimeAiService/StreamLocalAppTextTurn",
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/DeleteVoiceAsset",
		"/nimi.runtime.v1.RuntimeAiService/UploadArtifact",
		"/nimi.runtime.v1.RuntimeArtifactService/CleanupGeneratedVoiceArtifacts",
		"/nimi.runtime.v1.RuntimeArtifactService/PutArtifact",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/OpenRealtimeSession",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/AppendRealtimeInput",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/CloseRealtimeSession",
		"/nimi.runtime.v1.RuntimeAgentService/CancelHook",
		"/nimi.runtime.v1.RuntimeAgentService/CancelCompanionParticipation",
		"/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource",
		"/nimi.runtime.v1.RuntimeAgentService/DisableAutonomy",
		"/nimi.runtime.v1.RuntimeAgentService/EnableAutonomy",
		"/nimi.runtime.v1.RuntimeAgentService/InterruptAgentVoicePlayback",
		"/nimi.runtime.v1.RuntimeAgentService/TranscribeAgentVoiceInput",
		"/nimi.runtime.v1.RuntimeAgentService/OpenLocalAppConversation",
		"/nimi.runtime.v1.RuntimeAgentService/SendLocalAppConversationTurn",
		"/nimi.runtime.v1.RuntimeAgentService/UploadLocalAppConversationAttachment",
		"/nimi.runtime.v1.RuntimeAgentService/ReadLocalAppConversationArtifact",
		"/nimi.runtime.v1.RuntimeAgentService/TranscribeLocalAppConversationVoice",
		"/nimi.runtime.v1.RuntimeAgentService/InterruptLocalAppConversationTurn",
		"/nimi.runtime.v1.RuntimeAgentService/OverwriteLocalAppSharedLocalAgentAIConfig",
		"/nimi.runtime.v1.RuntimeAgentService/UpdateLocalAppAgentAutonomy",
		"/nimi.runtime.v1.RuntimeAgentService/CommitLocalAppAgentPresentation",
		"/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor",
		"/nimi.runtime.v1.RuntimeAgentService/RegisterAvatarLiveInstanceBinding",
		"/nimi.runtime.v1.RuntimeAgentService/RequestAgentCanonicalMemoryBankBind",
		"/nimi.runtime.v1.RuntimeAgentService/RequestCompanionParticipation",
		"/nimi.runtime.v1.RuntimeAgentService/RequestAvatarDebugProbe",
		"/nimi.runtime.v1.RuntimeAgentService/SubmitAvatarDebugProbeResult",
		"/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile",
		"/nimi.runtime.v1.RuntimeAgentService/SetAutonomyConfig",
		"/nimi.runtime.v1.RuntimeAgentService/SubmitDelegatedApprovalDecision",
		"/nimi.runtime.v1.RuntimeAgentService/TerminateAgent",
		"/nimi.runtime.v1.RuntimeAgentService/UpdateAgentState",
		"/nimi.runtime.v1.RuntimeAgentService/OverwriteSharedLocalAgentAIConfig",
		"/nimi.runtime.v1.RuntimeAgentService/ApplySharedLocalAgentAIProfile",
		"/nimi.runtime.v1.RuntimeAgentService/ImportPortableAIProfile",
		"/nimi.runtime.v1.RuntimeAgentService/WriteAgentMemory",
		"/nimi.runtime.v1.RuntimeExternalAgentService/IssueExternalAgentToken",
		"/nimi.runtime.v1.RuntimeExternalAgentService/RevokeExternalAgentToken",
		"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart",
		"/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession",
		"/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession",
		"/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession",
		"/nimi.runtime.v1.RuntimeAuthService/RegisterExternalPrincipal",
		"/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAuthService/RevokeExternalPrincipalSession",
		"/nimi.runtime.v1.RuntimeAccountService/BeginLogin",
		"/nimi.runtime.v1.RuntimeAccountService/CompleteLogin",
		"/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary",
		"/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification",
		"/nimi.runtime.v1.RuntimeAccountService/Logout",
		"/nimi.runtime.v1.RuntimeAccountService/SwitchAccount",
		"/nimi.runtime.v1.RuntimeAccountService/IssueWorkspaceBinding",
		"/nimi.runtime.v1.RuntimeAccountService/RevokeWorkspaceBinding",
		"/nimi.runtime.v1.RuntimeCognitionService/CreateBank",
		"/nimi.runtime.v1.RuntimeCognitionService/DeleteBank",
		"/nimi.runtime.v1.RuntimeCognitionService/Retain",
		"/nimi.runtime.v1.RuntimeCognitionService/DeleteMemory",
		"/nimi.runtime.v1.RuntimeCognitionService/RequestMemoryEmbeddingRuntimeBind",
		"/nimi.runtime.v1.RuntimeCognitionService/RequestMemoryEmbeddingRuntimeCutover",
		"/nimi.runtime.v1.RuntimeCognitionService/CreateKnowledgeBank",
		"/nimi.runtime.v1.RuntimeCognitionService/DeleteKnowledgeBank",
		"/nimi.runtime.v1.RuntimeCognitionService/PutPage",
		"/nimi.runtime.v1.RuntimeCognitionService/DeletePage",
		"/nimi.runtime.v1.RuntimeCognitionService/AddLink",
		"/nimi.runtime.v1.RuntimeCognitionService/RemoveLink",
		"/nimi.runtime.v1.RuntimeCognitionService/IngestDocument",
		"/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
		"/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson",
		"/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson",
		"/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset",
		"/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppAsset",
		"/nimi.runtime.v1.RuntimeAppService/MoveLocalAppAsset",
		"/nimi.runtime.v1.RuntimeAppService/AdoptLocalAppArtifact",
		"/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch",
		"/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess",
		"/nimi.runtime.v1.RuntimeAppService/RebindLocalAppProcess",
		"/nimi.runtime.v1.RuntimeDevelopmentService/SetDeveloperMode",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RegisterLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RemoveLocalDevelopmentRegistration",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EndLocalDevelopmentRun",
		"/nimi.runtime.v1.RuntimeLocalService/PrepareLoadout",
		"/nimi.runtime.v1.RuntimeLocalService/CommitLoadout",
		"/nimi.runtime.v1.RuntimeLocalService/UpdateLoadout",
		"/nimi.runtime.v1.RuntimeLocalService/SelectLoadout",
		"/nimi.runtime.v1.RuntimeLocalService/DeleteLoadout",
		"/nimi.runtime.v1.RuntimeLocalService/ImportModelAsset",
		"/nimi.runtime.v1.RuntimeLocalService/RemoveModelAsset",
		"/nimi.runtime.v1.RuntimeLocalService/InstallModelFromPlan",
		"/nimi.runtime.v1.RuntimeLocalService/ApplyLocalEnvironmentPlan",
		"/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob",
		"/nimi.runtime.v1.RuntimeLocalService/CancelLocalTransfer",
		"/nimi.runtime.v1.RuntimeLocalService/PauseLocalTransfer",
		"/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency",
		"/nimi.runtime.v1.RuntimeLocalService/ResolveLocalEnvironmentActivationGate",
		"/nimi.runtime.v1.RuntimeLocalService/ResumeLocalTransfer",
		"/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob",
		"/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob",
		"/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated",
		"/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot",
		"/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel",
		"/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan",
		"/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse",
		"/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState",
		"/nimi.runtime.v1.RuntimeLocalService/AppendInferenceAudit",
		"/nimi.runtime.v1.RuntimeLocalService/AppendRuntimeAudit",
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
