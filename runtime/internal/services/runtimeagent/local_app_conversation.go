package runtimeagent

import (
	"context"
	"crypto/subtle"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	localAppConversationMaxSelectorBytes     = 256
	localAppConversationMaxRequestIDBytes    = 256
	localAppConversationMaxTextBytes         = 64 * 1024
	localAppConversationMaxDisplayNameBytes  = 255
	localAppConversationSnapshotMaxMessages  = 200
	localAppConversationSnapshotMaxTextBytes = 1024 * 1024
	localAppConversationSubscriberBuffer     = 32
	localAppConversationRevalidationInterval = 250 * time.Millisecond
)

type localAppIngressRevalidator interface {
	AuthorizeLocalAppIngress(context.Context, localappop.Ingress) (context.Context, error)
}

type localAppConversationSubscriber struct {
	accountID            string
	registeredAppSubject string
	agentID              string
	conversationAnchorID string
	events               chan localAppConversationEmission
}

type localAppConversationEmission struct {
	event *runtimev1.LocalAppConversationEvent
	err   error
}

type localAppAgentIdentity struct {
	decision accountservice.LocalAppCallerDecision
	identity localAgentIdentity
	entry    *runtimev1.LocalAgentRecord
}

func (s *Service) SetLocalAppIngressRevalidator(revalidator localAppIngressRevalidator) {
	if s != nil {
		s.localAppIngressRevalidator = revalidator
	}
}

// @nimi-authority: definition.nimi.runtime.agent-participation.app-consume-plane
// @nimi-authority: rule.nimi.runtime.agent-participation.r093
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-003a
func (s *Service) OpenLocalAppConversation(
	ctx context.Context,
	req *runtimev1.OpenLocalAppConversationRequest,
) (*runtimev1.OpenLocalAppConversationResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation open request is required")
	}
	resolved, ownerCtx, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationOpenConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	ownerResponse, err := s.OpenConversationAnchor(ownerCtx, &runtimev1.OpenConversationAnchorRequest{
		AgentId: req.GetAgentHandle(),
	})
	if err != nil {
		return nil, err
	}
	snapshot := ownerResponse.GetSnapshot()
	anchorID := strings.TrimSpace(snapshot.GetAnchor().GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return nil, localAppConversationOwnerUnavailable()
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	response := &runtimev1.OpenLocalAppConversationResponse{ConversationAnchorId: anchorID}
	if activeTurnID := strings.TrimSpace(snapshot.GetActiveTurnId()); activeTurnID != "" {
		if !validLocalAppConversationSelector(activeTurnID) {
			return nil, localAppConversationOwnerUnavailable()
		}
		response.ActiveTurnId = &activeTurnID
	}
	return response, nil
}

func (s *Service) SendLocalAppConversationTurn(
	ctx context.Context,
	req *runtimev1.SendLocalAppConversationTurnRequest,
) (*runtimev1.SendLocalAppConversationTurnResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation turn request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	requestID := strings.TrimSpace(req.GetRequestId())
	if !validLocalAppConversationSelector(anchorID) ||
		!validLocalAppConversationText(requestID, localAppConversationMaxRequestIDBytes, false) {
		return nil, localAppConversationInvalid("local-app conversation turn input is invalid")
	}
	resolved, ownerCtx, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationSendConversationTurn,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	text, artifactID, err := parseLocalAppConversationInputParts(req.GetParts())
	if err != nil {
		return nil, err
	}
	message := publicChatMessagePayload{Role: "user", Content: text}
	if artifactID != "" {
		attachment, resolveErr := s.resolveLocalAppConversationAttachmentCandidate(resolved, anchorID, artifactID)
		if resolveErr != nil {
			return nil, resolveErr
		}
		message.Attachments = []publicChatAttachmentPayload{{
			ArtifactID:  attachment.ArtifactID,
			DisplayName: attachment.DisplayName,
		}}
	}
	turnID, err := s.publicChatRuntime().handleTurnRequestWithID(ownerCtx, &runtimev1.AppMessageEvent{
		FromAppId:     resolved.decision.AppID,
		SubjectUserId: resolved.decision.AccountID,
		MessageId:     requestID,
	}, publicChatTurnRequestPayload{
		LocalAgentRef:        resolved.identity.LocalAgentRef,
		OwnerUserID:          resolved.identity.OwnerUserID,
		RuntimeSourceRef:     resolved.identity.RuntimeSourceRef,
		ConversationAnchorID: anchorID,
		RequestID:            requestID,
		Messages:             []publicChatMessagePayload{message},
	})
	if err != nil {
		return nil, err
	}
	if !validLocalAppConversationSelector(turnID) {
		return nil, localAppConversationOwnerUnavailable()
	}
	return &runtimev1.SendLocalAppConversationTurnResponse{TurnId: turnID}, nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r179
func (s *Service) UploadLocalAppConversationAttachment(
	ctx context.Context,
	req *runtimev1.UploadLocalAppConversationAttachmentRequest,
) (*runtimev1.UploadLocalAppConversationAttachmentResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation attachment upload request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	displayName := strings.TrimSpace(req.GetDisplayName())
	if !validLocalAppConversationSelector(anchorID) ||
		!utf8.ValidString(displayName) || len([]byte(displayName)) > localAppConversationMaxDisplayNameBytes ||
		strings.ContainsRune(displayName, '\x00') {
		return nil, localAppConversationInvalid("local-app conversation attachment upload input is invalid")
	}
	resolved, _, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationConversationAttachmentUpload,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	mimeType, reason := runtimeartifact.ValidateImageUpload(req.GetMimeType(), req.GetData())
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		code := codes.InvalidArgument
		if reason == runtimev1.ReasonCode_ARTIFACT_UPLOAD_TOO_LARGE {
			code = codes.ResourceExhausted
		}
		return nil, grpcerr.WithReasonCode(code, reason)
	}
	if s.runtimeArtifacts == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	now := time.Now().UTC()
	expiresAt := now.Add(time.Hour)
	artifactID := "artifact_" + ulid.Make().String()
	if err := s.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes:     req.GetData(),
		MimeType:  mimeType,
		CreatedAt: now,
		Owner: &runtimeartifact.ArtifactOwner{
			SubjectUserID:        resolved.decision.AccountID,
			RegisteredAppSubject: resolved.decision.RegisteredAppSubject,
			AppID:                resolved.decision.AppID,
		},
		ConversationAttachment: &runtimeartifact.ConversationAttachmentArtifactMetadata{
			AgentID:              resolved.identity.LocalAgentRef,
			ConversationAnchorID: anchorID,
			DisplayName:          displayName,
			ExpiresAt:            expiresAt,
		},
	}); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "conversation attachment could not be stored"},
		)
	}
	return &runtimev1.UploadLocalAppConversationAttachmentResponse{
		ArtifactId: artifactID,
		ExpiresAt:  expiresAt.Format(time.RFC3339Nano),
	}, nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r178
func (s *Service) ReadLocalAppConversationArtifact(
	ctx context.Context,
	req *runtimev1.ReadLocalAppConversationArtifactRequest,
) (*runtimev1.ReadLocalAppConversationArtifactResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation artifact read request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	artifactID := strings.TrimSpace(req.GetArtifactId())
	if !validLocalAppConversationSelector(anchorID) || !validLocalAppConversationSelector(artifactID) {
		return nil, localAppConversationInvalid("local-app conversation artifact read input is invalid")
	}
	resolved, _, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationConversationArtifactRead,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	if s.runtimeArtifacts == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	record, ok := s.runtimeArtifacts.Get(artifactID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	mimeType := strings.ToLower(strings.TrimSpace(record.MimeType))
	expectedMime, member := s.localAppConversationTranscriptArtifactMembership(anchorID, artifactID)
	if !member {
		member = s.localAppConversationVoiceArtifactMembership(resolved, anchorID, artifactID, record)
		if member {
			expectedMime = mimeType
		}
	}
	if !member {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if expectedMime == "" || mimeType != expectedMime || record.SizeBytes != int64(len(record.Bytes)) {
		return nil, localAppConversationOwnerUnavailable()
	}
	if record.SizeBytes > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	return &runtimev1.ReadLocalAppConversationArtifactResponse{
		ArtifactId: artifactID,
		Data:       record.Bytes,
		MimeType:   mimeType,
		ByteLength: record.SizeBytes,
	}, nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r180
func (s *Service) TranscribeLocalAppConversationVoice(
	ctx context.Context,
	req *runtimev1.TranscribeLocalAppConversationVoiceRequest,
) (*runtimev1.TranscribeLocalAppConversationVoiceResponse, error) {
	if req != nil && len(req.GetAudioBytes()) > maxRuntimeAgentVoiceInputBytes {
		return nil, runtimeAgentVoiceInputTooLargeError()
	}
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation voice transcription request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	requestID := strings.TrimSpace(req.GetRequestId())
	mimeType := strings.ToLower(strings.TrimSpace(req.GetMimeType()))
	if !validLocalAppConversationSelector(anchorID) ||
		!validLocalAppConversationText(requestID, localAppConversationMaxRequestIDBytes, false) ||
		len(req.GetAudioBytes()) == 0 || !strings.HasPrefix(mimeType, "audio/") ||
		strings.ContainsAny(mimeType, " \t\r\n\x00") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	resolved, ownerCtx, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationConversationVoiceTranscribe,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	if s == nil || s.isClosed() || s.voiceTranscription == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	result, err := s.transcribeAgentVoiceInput(
		ownerCtx,
		resolved.identity,
		anchorID,
		mimeType,
		requestID,
		localAppVoiceTranscriptionRequestScope(resolved),
		req.GetAudioBytes(),
	)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(result.GetText())
	if text == "" || len([]byte(text)) > localAppConversationMaxTextBytes {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return &runtimev1.TranscribeLocalAppConversationVoiceResponse{Text: text}, nil
}

func localAppVoiceTranscriptionRequestScope(resolved localAppAgentIdentity) string {
	material := []byte(strings.TrimSpace(resolved.decision.AppID) + "\x00" + strings.TrimSpace(resolved.decision.RegisteredAppSubject) + "\x00")
	material = append(material, resolved.decision.SessionID[:]...)
	return sha256HexBytes(material)
}

func parseLocalAppConversationInputParts(
	parts []*runtimev1.LocalAppConversationInputPart,
) (string, string, error) {
	if len(parts) < 1 || len(parts) > 2 {
		return "", "", localAppConversationInvalid("local-app conversation turn parts are invalid")
	}
	text := ""
	artifactID := ""
	for index, part := range parts {
		if part == nil {
			return "", "", localAppConversationInvalid("local-app conversation turn part is invalid")
		}
		if textPart := part.GetText(); textPart != nil {
			if text != "" || artifactID != "" || index != 0 ||
				!validLocalAppConversationText(textPart.GetText(), localAppConversationMaxTextBytes, false) {
				return "", "", localAppConversationInvalid("local-app conversation text part is invalid")
			}
			text = textPart.GetText()
			continue
		}
		if artifactPart := part.GetArtifactRef(); artifactPart != nil {
			if artifactID != "" || !validLocalAppConversationSelector(artifactPart.GetArtifactId()) {
				return "", "", localAppConversationInvalid("local-app conversation artifact part is invalid")
			}
			artifactID = strings.TrimSpace(artifactPart.GetArtifactId())
			continue
		}
		return "", "", localAppConversationInvalid("local-app conversation turn part kind is invalid")
	}
	if text == "" && artifactID == "" {
		return "", "", localAppConversationInvalid("local-app conversation turn requires content")
	}
	return text, artifactID, nil
}

func (s *Service) resolveLocalAppConversationAttachmentCandidate(
	resolved localAppAgentIdentity,
	anchorID string,
	artifactID string,
) (publicChatResolvedAttachment, error) {
	if s == nil || s.runtimeArtifacts == nil {
		return publicChatResolvedAttachment{}, localAppConversationOwnerUnavailable()
	}
	record, ok := s.runtimeArtifacts.Get(strings.TrimSpace(artifactID))
	if !ok {
		return publicChatResolvedAttachment{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	metadata := record.ConversationAttachment
	owner := record.Owner
	registeredMatches := owner != nil && (owner.RegisteredAppSubject == "" ||
		owner.RegisteredAppSubject == resolved.decision.RegisteredAppSubject)
	if metadata == nil || owner == nil ||
		owner.SubjectUserID != resolved.decision.AccountID || owner.AppID != resolved.decision.AppID || !registeredMatches ||
		metadata.AgentID != resolved.identity.LocalAgentRef || metadata.ConversationAnchorID != strings.TrimSpace(anchorID) ||
		!time.Now().UTC().Before(metadata.ExpiresAt) {
		return publicChatResolvedAttachment{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if _, member := s.localAppConversationTranscriptArtifactMembership(anchorID, artifactID); member {
		return publicChatResolvedAttachment{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	return publicChatResolvedAttachment{
		ArtifactID:  strings.TrimSpace(artifactID),
		MimeType:    strings.ToLower(strings.TrimSpace(record.MimeType)),
		DisplayName: metadata.DisplayName,
	}, nil
}

func (s *Service) localAppConversationTranscriptArtifactMembership(
	anchorID string,
	artifactID string,
) (string, bool) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		return "", false
	}
	artifactID = strings.TrimSpace(artifactID)
	for _, turn := range anchor.CommittedTranscript {
		if turn.InputAttachment != nil && strings.TrimSpace(turn.InputAttachment.ArtifactID) == artifactID {
			return strings.ToLower(strings.TrimSpace(turn.InputAttachment.MimeType)), true
		}
		for _, artifact := range turn.OutputArtifacts {
			if strings.TrimSpace(artifact.ArtifactID) == artifactID {
				return strings.ToLower(strings.TrimSpace(artifact.MimeType)), true
			}
		}
	}
	return "", false
}

func (s *Service) InterruptLocalAppConversationTurn(
	ctx context.Context,
	req *runtimev1.InterruptLocalAppConversationTurnRequest,
) (*runtimev1.InterruptLocalAppConversationTurnResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation interrupt request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return nil, localAppConversationInvalid("local-app conversation anchor is invalid")
	}
	resolved, _, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationInterruptConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	turnID, err := s.publicChatRuntime().handleTurnInterruptWithID(&runtimev1.AppMessageEvent{
		FromAppId:     resolved.decision.AppID,
		SubjectUserId: resolved.decision.AccountID,
	}, publicChatTurnInterruptPayload{
		ConversationAnchorID: anchorID,
		Reason:               "user_cancel",
	})
	if err != nil {
		return nil, err
	}
	if !validLocalAppConversationSelector(turnID) {
		return nil, localAppConversationOwnerUnavailable()
	}
	return &runtimev1.InterruptLocalAppConversationTurnResponse{TurnId: turnID}, nil
}

func (s *Service) GetLocalAppConversationSnapshot(
	ctx context.Context,
	req *runtimev1.GetLocalAppConversationSnapshotRequest,
) (*runtimev1.GetLocalAppConversationSnapshotResponse, error) {
	if req == nil {
		return nil, localAppConversationInvalid("local-app conversation snapshot request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return nil, localAppConversationInvalid("local-app conversation anchor is invalid")
	}
	resolved, _, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationConversationSnapshot,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	snapshot, err := s.buildLocalAppConversationSnapshot(resolved, anchorID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetLocalAppConversationSnapshotResponse{Snapshot: snapshot}, nil
}

func (s *Service) SubscribeLocalAppConversationEvents(
	req *runtimev1.SubscribeLocalAppConversationEventsRequest,
	stream runtimev1.RuntimeAgentService_SubscribeLocalAppConversationEventsServer,
) error {
	if req == nil || stream == nil {
		return localAppConversationInvalid("local-app conversation subscription request is required")
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if !validLocalAppConversationSelector(anchorID) {
		return localAppConversationInvalid("local-app conversation anchor is invalid")
	}
	resolved, _, err := s.resolveLocalAppAgent(
		stream.Context(),
		accountservice.LocalAppOperationSubscribeConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return err
	}
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return err
	}
	if s.localAppIngressRevalidator == nil {
		return localAppConversationOwnerUnavailable()
	}
	subscriberID, events := s.addLocalAppConversationSubscriber(localAppConversationSubscriber{
		accountID:            resolved.decision.AccountID,
		registeredAppSubject: resolved.decision.RegisteredAppSubject,
		agentID:              resolved.identity.LocalAgentRef,
		conversationAnchorID: anchorID,
	})
	defer s.removeLocalAppConversationSubscriber(subscriberID)

	// The streaming client treats response headers as the subscription-established
	// signal; without an explicit flush gRPC defers headers until the first event
	// and an idle conversation blocks the subscriber indefinitely.
	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}

	ticker := time.NewTicker(localAppConversationRevalidationInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case <-ticker.C:
			if err := s.revalidateLocalAppConversationSubscription(stream.Context(), req, resolved); err != nil {
				return err
			}
		case emitted := <-events:
			if emitted.err != nil {
				return emitted.err
			}
			if emitted.event == nil {
				return localAppConversationOwnerUnavailable()
			}
			if err := s.revalidateLocalAppConversationSubscription(stream.Context(), req, resolved); err != nil {
				return err
			}
			if err := stream.Send(proto.Clone(emitted.event).(*runtimev1.LocalAppConversationEvent)); err != nil {
				return err
			}
		}
	}
}

// resolveLocalAppAgent re-verifies the exact admitted operation and resolves
// the session-scoped opaque handle against the current-account active-Agent
// inventory. Conversation and agent-configuration owner adapters share this
// single fail-closed resolution path.
func (s *Service) resolveLocalAppAgent(
	ctx context.Context,
	operation accountservice.LocalAppOperation,
	agentHandle string,
) (localAppAgentIdentity, context.Context, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, operation)
	classification, classificationErr := localappop.ClassifyOperation(operation)
	if !ok || classificationErr != nil || decision.OperationCapability != string(classification.Domain) ||
		!validLocalAppAgentHandle(agentHandle) {
		return localAppAgentIdentity{}, nil, localAppAgentAccessDenied()
	}

	s.mu.RLock()
	var selected *runtimev1.LocalAgentRecord
	matches := 0
	for _, candidate := range s.agents {
		if candidate == nil || candidate.Agent == nil ||
			candidate.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
			strings.TrimSpace(candidate.Agent.GetOwnerUserId()) != decision.AccountID {
			continue
		}
		localAgentID := strings.TrimSpace(candidate.Agent.GetLocalAgentRef())
		if localAgentID == "" {
			continue
		}
		expected := mintLocalAppAgentHandle(decision, localAgentID)
		if len(expected) == len(agentHandle) && subtle.ConstantTimeCompare([]byte(expected), []byte(agentHandle)) == 1 {
			selected = proto.Clone(candidate.Agent).(*runtimev1.LocalAgentRecord)
			matches++
		}
	}
	s.mu.RUnlock()
	if matches != 1 || selected == nil {
		return localAppAgentIdentity{}, nil, localAppAgentAccessDenied()
	}
	identity, err := validateLocalAgentIdentity(
		selected.GetOwnerUserId(),
		selected.GetRuntimeSourceRef(),
		selected.GetLocalAgentRef(),
	)
	if err != nil || identity.OwnerUserID != decision.AccountID {
		return localAppAgentIdentity{}, nil, localAppAgentAccessDenied()
	}
	decision.LocalAgentID = identity.LocalAgentRef
	ownerCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
	return localAppAgentIdentity{decision: decision, identity: identity, entry: selected}, ownerCtx, nil
}

func (s *Service) validateLocalAppConversationResource(
	resolved localAppAgentIdentity,
	anchorID string,
) error {
	if s == nil || resolved.entry == nil ||
		resolved.entry.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE ||
		resolved.identity.OwnerUserID != resolved.decision.AccountID ||
		!validLocalAppConversationSelector(anchorID) {
		return localAppAgentAccessDenied()
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	valid := anchor != nil && conversationAnchorIsResumable(anchor.Status) &&
		anchor.AgentID == resolved.identity.LocalAgentRef &&
		anchor.LocalAgentRef == resolved.identity.LocalAgentRef &&
		anchor.OwnerUserID == resolved.identity.OwnerUserID &&
		anchor.SubjectUserID == resolved.decision.AccountID &&
		anchor.RuntimeSourceRef == resolved.identity.RuntimeSourceRef
	s.chatSurfaceMu.Unlock()
	if !valid {
		return status.Error(codes.NotFound, "local-app conversation resource not found")
	}
	return nil
}

func (s *Service) buildLocalAppConversationSnapshot(
	resolved localAppAgentIdentity,
	anchorID string,
) (*runtimev1.LocalAppConversationSnapshot, error) {
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	transcript := clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
	throughSequence := anchor.LocalAppSequence
	activeSnapshot := clonePublicChatTurnProjectionState(anchor.ActiveTurnSnapshot)
	terminalSnapshots := clonePublicChatTurnProjectionStateMap(anchor.CompletedTurnSnapshots)
	voiceSidecars := clonePublicChatVoiceSidecars(anchor.VoiceSidecars)
	s.chatSurfaceMu.Unlock()
	if err := validatePublicChatCommittedTranscript(transcript); err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}

	type messageGroup struct {
		messages []*runtimev1.LocalAppConversationMessage
		turn     *runtimev1.LocalAppConversationTurn
		actions  []*runtimev1.LocalAppConversationAction
		bytes    int
	}
	groups := make([]messageGroup, 0, len(transcript))
	var activeGroup *messageGroup
	seenTurnIDs := make(map[string]struct{}, len(transcript))
	for _, turn := range transcript {
		if turn.Origin != publicChatTurnOriginUser || !validLocalAppConversationSelector(turn.TurnID) {
			continue
		}
		seenTurnIDs[turn.TurnID] = struct{}{}
		group := messageGroup{}
		userMessage := localAppConversationUserMessage(turn)
		if userMessage == nil {
			return nil, localAppConversationOwnerUnavailable()
		}
		group.messages = append(group.messages, userMessage)
		group.bytes += len(turn.InputText)
		if strings.TrimSpace(turn.AssistantText) != "" && !validLocalAppConversationText(turn.AssistantText, localAppConversationMaxTextBytes, true) {
			return nil, localAppConversationOwnerUnavailable()
		}
		if strings.TrimSpace(turn.AssistantText) != "" {
			group.messages = append(group.messages, localAppConversationTextMessage(
				turn.TurnID,
				runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT,
				turn.AssistantText,
			))
			group.bytes += len(turn.AssistantText)
		}
		projection := terminalSnapshots[turn.TurnID]
		active := activeSnapshot != nil && strings.TrimSpace(activeSnapshot.TurnID) == turn.TurnID
		if active {
			projection = activeSnapshot
		}
		group.turn = localAppConversationTurnFromProjection(turn.TurnID, projection, active)
		for index := range turn.OutputArtifacts {
			artifact := turn.OutputArtifacts[index]
			message := localAppConversationArtifactMessage(turn.TurnID, artifact)
			group.messages = append(group.messages, message)
			group.actions = append(group.actions, localAppConversationCompletedAction(turn.TurnID, projection, message, artifact))
		}
		if len(turn.OutputArtifacts) == 0 {
			if action := localAppConversationNonCompletedAction(turn.TurnID, projection); action != nil {
				group.actions = append(group.actions, action)
			}
		}
		if active {
			copy := group
			activeGroup = &copy
			continue
		}
		groups = append(groups, group)
	}
	terminalOnlyIDs := make([]string, 0)
	for turnID, projection := range terminalSnapshots {
		if _, exists := seenTurnIDs[turnID]; exists || !publicChatTurnProjectionIsTerminal(projection) {
			continue
		}
		terminalOnlyIDs = append(terminalOnlyIDs, turnID)
	}
	sort.Slice(terminalOnlyIDs, func(left, right int) bool {
		leftProjection := terminalSnapshots[terminalOnlyIDs[left]]
		rightProjection := terminalSnapshots[terminalOnlyIDs[right]]
		leftTime := leftProjection.TimelineStartedAt
		if leftTime.IsZero() {
			leftTime = leftProjection.UpdatedAt
		}
		rightTime := rightProjection.TimelineStartedAt
		if rightTime.IsZero() {
			rightTime = rightProjection.UpdatedAt
		}
		if !leftTime.Equal(rightTime) {
			return leftTime.Before(rightTime)
		}
		return terminalOnlyIDs[left] < terminalOnlyIDs[right]
	})
	for _, turnID := range terminalOnlyIDs {
		projection := terminalSnapshots[turnID]
		group := messageGroup{turn: localAppConversationTurnFromProjection(turnID, projection, false)}
		if action := localAppConversationNonCompletedAction(turnID, projection); action != nil {
			group.actions = append(group.actions, action)
		}
		groups = append(groups, group)
	}

	start := len(groups)
	messageCount := 0
	textBytes := 0
	for start > 0 {
		candidate := groups[start-1]
		if messageCount+len(candidate.messages) > localAppConversationSnapshotMaxMessages ||
			textBytes+candidate.bytes > localAppConversationSnapshotMaxTextBytes {
			break
		}
		start--
		messageCount += len(candidate.messages)
		textBytes += candidate.bytes
	}
	activeMessageCount := 0
	if activeGroup != nil {
		activeMessageCount = len(activeGroup.messages)
	}
	messages := make([]*runtimev1.LocalAppConversationMessage, 0, messageCount+activeMessageCount)
	turns := make([]*runtimev1.LocalAppConversationTurn, 0, len(groups)-start+1)
	actions := make([]*runtimev1.LocalAppConversationAction, 0)
	for _, group := range groups[start:] {
		messages = append(messages, group.messages...)
		if group.turn != nil {
			turns = append(turns, group.turn)
		}
		actions = append(actions, group.actions...)
	}
	if activeGroup != nil {
		messages = append(messages, activeGroup.messages...)
		if activeGroup.turn != nil {
			turns = append(turns, activeGroup.turn)
		}
		actions = append(actions, activeGroup.actions...)
	}
	if activeSnapshot != nil && strings.TrimSpace(activeSnapshot.TurnID) != "" {
		found := false
		for _, turn := range turns {
			if turn.GetTurnId() == activeSnapshot.TurnID {
				found = true
				break
			}
		}
		if !found {
			turns = append(turns, localAppConversationTurnFromProjection(activeSnapshot.TurnID, activeSnapshot, true))
		}
	}
	snapshot := &runtimev1.LocalAppConversationSnapshot{
		ConversationAnchorId: anchorID,
		Messages:             messages,
		TruncatedBefore:      start > 0,
		ThroughSequence:      throughSequence,
		Turns:                turns,
		Actions:              actions,
	}
	messageIDs := make(map[string]struct{}, len(messages))
	for _, message := range messages {
		messageIDs[message.GetMessageId()] = struct{}{}
	}
	for _, turn := range turns {
		voice := voiceSidecars[turn.GetTurnId()]
		if voice == nil {
			continue
		}
		if _, ok := messageIDs[voice.MessageID]; !ok {
			return nil, localAppConversationOwnerUnavailable()
		}
		projected := localAppConversationVoiceFromState(voice)
		if projected == nil {
			return nil, localAppConversationOwnerUnavailable()
		}
		snapshot.Voices = append(snapshot.Voices, projected)
	}
	return snapshot, nil
}

func localAppConversationMessageID(turnID string, kind string, ref string) string {
	digest := sha256HexBytes([]byte(strings.TrimSpace(turnID) + "\x00" + strings.TrimSpace(kind) + "\x00" + strings.TrimSpace(ref)))
	return "local_app_message_" + digest[:24]
}

func localAppConversationTextMessage(
	turnID string,
	role runtimev1.LocalAppConversationMessageRole,
	value string,
) *runtimev1.LocalAppConversationMessage {
	kind := "assistant"
	if role == runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER {
		kind = "user"
	}
	return &runtimev1.LocalAppConversationMessage{
		TurnId:    strings.TrimSpace(turnID),
		Role:      role,
		MessageId: localAppConversationMessageID(turnID, kind, ""),
		Parts: []*runtimev1.LocalAppConversationMessagePart{{
			Part: &runtimev1.LocalAppConversationMessagePart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: strings.TrimSpace(value)}},
		}},
	}
}

func localAppConversationUserMessage(
	turn publicChatCommittedTranscriptTurn,
) *runtimev1.LocalAppConversationMessage {
	parts := make([]*runtimev1.LocalAppConversationMessagePart, 0, 2)
	if strings.TrimSpace(turn.InputText) != "" {
		if !validLocalAppConversationText(turn.InputText, localAppConversationMaxTextBytes, false) {
			return nil
		}
		parts = append(parts, &runtimev1.LocalAppConversationMessagePart{
			Part: &runtimev1.LocalAppConversationMessagePart_Text{Text: &runtimev1.LocalAppConversationTextPart{Text: strings.TrimSpace(turn.InputText)}},
		})
	}
	if attachment := normalizePublicChatCommittedTranscriptAttachment(turn.InputAttachment); attachment != nil {
		part := &runtimev1.LocalAppConversationArtifactPart{
			ArtifactId: attachment.ArtifactID,
			MediaKind:  runtimev1.LocalAppConversationMediaKind_LOCAL_APP_CONVERSATION_MEDIA_KIND_IMAGE,
			MimeType:   attachment.MimeType,
		}
		if attachment.DisplayName != "" {
			displayName := attachment.DisplayName
			part.DisplayName = &displayName
		}
		parts = append(parts, &runtimev1.LocalAppConversationMessagePart{
			Part: &runtimev1.LocalAppConversationMessagePart_Artifact{Artifact: part},
		})
	}
	if len(parts) == 0 {
		return nil
	}
	return &runtimev1.LocalAppConversationMessage{
		TurnId:    strings.TrimSpace(turn.TurnID),
		Role:      runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER,
		MessageId: localAppConversationMessageID(turn.TurnID, "user", ""),
		Parts:     parts,
	}
}

func localAppConversationArtifactMessage(
	turnID string,
	artifact publicChatCommittedTranscriptAttachment,
) *runtimev1.LocalAppConversationMessage {
	artifactID := strings.TrimSpace(artifact.ArtifactID)
	part := &runtimev1.LocalAppConversationArtifactPart{
		ArtifactId: artifactID,
		MediaKind:  runtimev1.LocalAppConversationMediaKind_LOCAL_APP_CONVERSATION_MEDIA_KIND_IMAGE,
		MimeType:   strings.ToLower(strings.TrimSpace(artifact.MimeType)),
	}
	if displayName := strings.TrimSpace(artifact.DisplayName); displayName != "" {
		part.DisplayName = &displayName
	}
	return &runtimev1.LocalAppConversationMessage{
		TurnId:    strings.TrimSpace(turnID),
		Role:      runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT,
		MessageId: localAppConversationMessageID(turnID, "image", artifactID),
		Parts: []*runtimev1.LocalAppConversationMessagePart{{
			Part: &runtimev1.LocalAppConversationMessagePart_Artifact{Artifact: part},
		}},
	}
}

func localAppConversationTurnFromProjection(
	turnID string,
	projection *publicChatTurnProjectionState,
	active bool,
) *runtimev1.LocalAppConversationTurn {
	result := &runtimev1.LocalAppConversationTurn{
		TurnId: strings.TrimSpace(turnID),
		Status: runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_COMPLETED,
	}
	if active || projection == nil {
		result.Status = runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_ACTIVE
		result.Phase = runtimev1.LocalAppConversationTurnPhase_LOCAL_APP_CONVERSATION_TURN_PHASE_ACCEPTED
		if projection != nil && projection.Status != publicChatTurnStatusAccepted {
			result.Phase = runtimev1.LocalAppConversationTurnPhase_LOCAL_APP_CONVERSATION_TURN_PHASE_STARTED
		}
		return result
	}
	result.ReasonCode = projection.ReasonCode
	if value := strings.TrimSpace(projection.Message); value != "" {
		result.Message = &value
	}
	switch projection.Status {
	case publicChatTurnStatusFailed:
		result.Status = runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_FAILED
	case publicChatTurnStatusInterrupted:
		result.Status = runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_INTERRUPTED
	default:
		result.Status = runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_COMPLETED
		if value := strings.TrimSpace(projection.FinishReason); value != "" {
			result.TerminalReason = &value
		}
	}
	return result
}

func localAppConversationActionIdentity(turnID string, projection *publicChatTurnProjectionState) (string, string) {
	actionID := ""
	capability := "image.generate"
	if projection != nil && projection.Structured != nil && len(projection.Structured.Actions) > 0 {
		actionID = strings.TrimSpace(projection.Structured.Actions[0].ActionID)
		if value := strings.TrimSpace(projection.Structured.Actions[0].Operation); value != "" {
			capability = value
		}
	}
	if actionID == "" {
		digest := sha256HexBytes([]byte(strings.TrimSpace(turnID) + "\x00" + capability))
		actionID = "local_app_action_" + digest[:24]
	}
	return actionID, capability
}

func localAppConversationCompletedAction(
	turnID string,
	projection *publicChatTurnProjectionState,
	message *runtimev1.LocalAppConversationMessage,
	artifact publicChatCommittedTranscriptAttachment,
) *runtimev1.LocalAppConversationAction {
	actionID, capability := localAppConversationActionIdentity(turnID, projection)
	messageID := strings.TrimSpace(message.GetMessageId())
	artifactID := strings.TrimSpace(artifact.ArtifactID)
	return &runtimev1.LocalAppConversationAction{
		ActionId:            actionID,
		TurnId:              strings.TrimSpace(turnID),
		CapabilityContract:  capability,
		Status:              runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_COMPLETED,
		ProjectionMessageId: &messageID,
		ArtifactId:          &artifactID,
	}
}

func localAppConversationNonCompletedAction(
	turnID string,
	projection *publicChatTurnProjectionState,
) *runtimev1.LocalAppConversationAction {
	if projection == nil || projection.Structured == nil || len(projection.Structured.Actions) == 0 {
		return nil
	}
	actionID, capability := localAppConversationActionIdentity(turnID, projection)
	action := &runtimev1.LocalAppConversationAction{
		ActionId:           actionID,
		TurnId:             strings.TrimSpace(turnID),
		CapabilityContract: capability,
	}
	switch projection.ActionStatus {
	case publicChatActionStatusPlanned:
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_PLANNED
		return action
	case publicChatActionStatusStarted:
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_STARTED
		return action
	case publicChatActionStatusFailed:
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_FAILED
		action.ReasonCode = projection.ActionReasonCode
		if action.ReasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			action.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		}
		if message := strings.TrimSpace(projection.ActionMessage); message != "" {
			action.Message = &message
		}
		return action
	default:
		message := strings.TrimSpace(projection.Message)
		if message == "" {
			return nil
		}
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_FAILED
		action.ReasonCode = projection.ReasonCode
		if action.ReasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			action.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		}
		action.Message = &message
		return action
	}
}

func (s *Service) localAppCommittedTextMessages(anchorID string, turnID string) ([]*runtimev1.LocalAppConversationMessage, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	for _, turn := range anchor.CommittedTranscript {
		if strings.TrimSpace(turn.TurnID) != strings.TrimSpace(turnID) || turn.Origin != publicChatTurnOriginUser {
			continue
		}
		messages := make([]*runtimev1.LocalAppConversationMessage, 0, 2)
		userMessage := localAppConversationUserMessage(turn)
		if userMessage == nil {
			return nil, localAppConversationOwnerUnavailable()
		}
		messages = append(messages, userMessage)
		if strings.TrimSpace(turn.AssistantText) != "" {
			messages = append(messages, localAppConversationTextMessage(
				turn.TurnID,
				runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT,
				turn.AssistantText,
			))
		}
		if len(messages) == 0 {
			return nil, localAppConversationOwnerUnavailable()
		}
		return messages, nil
	}
	return nil, localAppConversationOwnerUnavailable()
}

func (s *Service) localAppCommittedOutputArtifact(anchorID string, turnID string, artifactID string) (*publicChatCommittedTranscriptAttachment, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	for _, turn := range anchor.CommittedTranscript {
		if strings.TrimSpace(turn.TurnID) != strings.TrimSpace(turnID) {
			continue
		}
		for index := range turn.OutputArtifacts {
			artifact := turn.OutputArtifacts[index]
			if artifact.ArtifactID == strings.TrimSpace(artifactID) {
				copy := artifact
				return &copy, nil
			}
		}
	}
	return nil, localAppConversationOwnerUnavailable()
}

func localAppConversationActionFromEvent(
	messageType string,
	turnID string,
	detail map[string]any,
) (*runtimev1.LocalAppConversationAction, error) {
	actionID, actionOK := localAppConversationMapString(detail, "action_id", false)
	capability, capabilityOK := localAppConversationMapString(detail, "operation", false)
	if !actionOK || !capabilityOK || !validLocalAppConversationSelector(actionID) || capability != "image.generate" {
		return nil, localAppConversationOwnerUnavailable()
	}
	action := &runtimev1.LocalAppConversationAction{
		ActionId:           actionID,
		TurnId:             strings.TrimSpace(turnID),
		CapabilityContract: capability,
	}
	switch strings.TrimSpace(messageType) {
	case publicChatTurnActionPlannedType:
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_PLANNED
	case publicChatTurnActionStartedType:
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_STARTED
	case publicChatTurnActionCompletedType:
		artifactID, ok := localAppConversationMapString(detail, "artifact_id", false)
		if !ok || !validLocalAppConversationSelector(artifactID) {
			return nil, localAppConversationOwnerUnavailable()
		}
		messageID := localAppConversationMessageID(turnID, "image", artifactID)
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_COMPLETED
		action.ProjectionMessageId = &messageID
		action.ArtifactId = &artifactID
	case publicChatTurnActionFailedType:
		action.Status = runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_FAILED
		reasonCode, ok := localAppConversationReasonCode(detail["reason_code"])
		if !ok {
			return nil, localAppConversationOwnerUnavailable()
		}
		action.ReasonCode = reasonCode
		if value, present := detail["message"]; present {
			message, ok := value.(string)
			if !ok || !validLocalAppConversationText(message, 1024, true) {
				return nil, localAppConversationOwnerUnavailable()
			}
			message = strings.TrimSpace(message)
			action.Message = &message
		}
	default:
		return nil, localAppConversationOwnerUnavailable()
	}
	return action, nil
}

func localAppConversationReasonCode(value any) (runtimev1.ReasonCode, bool) {
	text, ok := value.(string)
	if !ok || !validLocalAppConversationReasonCode(text) {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}
	numeric, ok := runtimev1.ReasonCode_value[text]
	if !ok || runtimev1.ReasonCode(numeric) == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
	}
	return runtimev1.ReasonCode(numeric), true
}

func (s *Service) revalidateLocalAppConversationSubscription(
	ctx context.Context,
	req *runtimev1.SubscribeLocalAppConversationEventsRequest,
	initial localAppAgentIdentity,
) error {
	ownerCtx, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(
		ctx,
		localappop.IngressConversationEventsSubscribe,
	)
	if err != nil {
		return err
	}
	current, _, err := s.resolveLocalAppAgent(
		ownerCtx,
		accountservice.LocalAppOperationSubscribeConversation,
		req.GetAgentHandle(),
	)
	if err != nil {
		return err
	}
	if current.decision.SessionID != initial.decision.SessionID ||
		current.decision.AccountID != initial.decision.AccountID ||
		current.decision.RegisteredAppSubject != initial.decision.RegisteredAppSubject ||
		current.identity.LocalAgentRef != initial.identity.LocalAgentRef {
		return localAppAgentAccessDenied()
	}
	return s.validateLocalAppConversationResource(current, req.GetConversationAnchorId())
}

func (s *Service) addLocalAppConversationSubscriber(
	input localAppConversationSubscriber,
) (uint64, <-chan localAppConversationEmission) {
	s.localAppConversationMu.Lock()
	defer s.localAppConversationMu.Unlock()
	s.localAppConversationNextSubscriberID++
	input.events = make(chan localAppConversationEmission, localAppConversationSubscriberBuffer)
	s.localAppConversationSubscribers[s.localAppConversationNextSubscriberID] = &input
	return s.localAppConversationNextSubscriberID, input.events
}

func (s *Service) removeLocalAppConversationSubscriber(id uint64) {
	s.localAppConversationMu.Lock()
	delete(s.localAppConversationSubscribers, id)
	s.localAppConversationMu.Unlock()
}

func (s *Service) failLocalAppConversationSubscribers(err error) {
	if s == nil || err == nil {
		return
	}
	s.localAppConversationMu.Lock()
	subscribers := make([]*localAppConversationSubscriber, 0, len(s.localAppConversationSubscribers))
	for _, subscriber := range s.localAppConversationSubscribers {
		if subscriber != nil {
			subscribers = append(subscribers, subscriber)
		}
	}
	s.localAppConversationMu.Unlock()
	for _, subscriber := range subscribers {
		select {
		case subscriber.events <- localAppConversationEmission{err: err}:
		default:
		}
	}
}

func (s *Service) publishLocalAppConversationEvent(
	subjectUserID string,
	messageType string,
	payload map[string]any,
) {
	anchorID, _ := localAppConversationMapString(payload, "conversation_anchor_id", false)
	if !validLocalAppConversationSelector(anchorID) {
		return
	}
	sequence := s.nextLocalAppConversationSequence(anchorID)
	if sequence == 0 {
		return
	}
	// The high-water belongs to the durable Conversation anchor, including
	// gaps for private sideband events filtered from the protected projection.
	s.persistCurrentPublicChatSurfaceState()
	events, supported, err := s.projectLocalAppConversationEvents(messageType, payload, sequence)
	if !supported {
		return
	}
	s.localAppConversationMu.Lock()
	subscribers := make([]*localAppConversationSubscriber, 0, len(s.localAppConversationSubscribers))
	for _, subscriber := range s.localAppConversationSubscribers {
		if subscriber != nil && subscriber.accountID == strings.TrimSpace(subjectUserID) &&
			(subscriber.conversationAnchorID == anchorID || (err != nil && anchorID == "")) {
			subscribers = append(subscribers, subscriber)
		}
	}
	s.localAppConversationMu.Unlock()
	for _, subscriber := range subscribers {
		if err != nil {
			sendLocalAppConversationEmission(subscriber, localAppConversationEmission{err: err})
			continue
		}
		for _, event := range events {
			if event != nil {
				sendLocalAppConversationEmission(subscriber, localAppConversationEmission{event: event})
			}
		}
	}
}

func sendLocalAppConversationEmission(subscriber *localAppConversationSubscriber, emission localAppConversationEmission) {
	select {
	case subscriber.events <- emission:
	default:
		select {
		case <-subscriber.events:
		default:
		}
		retryable := true
		select {
		case subscriber.events <- localAppConversationEmission{err: grpcerr.WithReasonCodeOptions(
			codes.ResourceExhausted,
			runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE,
			grpcerr.ReasonOptions{
				Retryable: &retryable,
				Metadata:  map[string]string{"diagnostic_stage": "local_app_conversation_subscription_overflow"},
			},
		)}:
		default:
		}
	}
}

func (s *Service) nextLocalAppConversationSequence(anchorID string) uint64 {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		return 0
	}
	anchor.LocalAppSequence++
	return anchor.LocalAppSequence
}

func (s *Service) projectLocalAppConversationEvents(
	messageType string,
	payload map[string]any,
	sequence uint64,
) ([]*runtimev1.LocalAppConversationEvent, bool, error) {
	supported := false
	switch strings.TrimSpace(messageType) {
	case publicChatTurnAcceptedType, publicChatTurnStartedType,
		publicChatTurnMessageCommittedType, publicChatTurnCompletedType,
		publicChatTurnFailedType, publicChatTurnInterruptedType,
		publicChatTurnActionPlannedType, publicChatTurnActionStartedType,
		publicChatTurnArtifactReadyType, publicChatTurnActionCompletedType,
		publicChatTurnActionFailedType, publicChatTurnVoiceReadyType,
		publicChatTurnVoiceFailedType:
		supported = true
	}
	if !supported {
		return nil, false, nil
	}
	anchorID, anchorOK := localAppConversationMapString(payload, "conversation_anchor_id", false)
	turnID, turnOK := localAppConversationMapString(payload, "turn_id", false)
	detail, detailOK := payload["detail"].(map[string]any)
	_, timelineOK := payload["timeline"].(map[string]any)
	if !anchorOK || !turnOK || !detailOK || !timelineOK || sequence == 0 ||
		!validLocalAppConversationSelector(anchorID) || !validLocalAppConversationSelector(turnID) {
		return nil, true, localAppConversationOwnerUnavailable()
	}
	if strings.TrimSpace(messageType) == publicChatTurnMessageCommittedType {
		messages, err := s.localAppCommittedTextMessages(anchorID, turnID)
		if err != nil {
			return nil, true, err
		}
		events := make([]*runtimev1.LocalAppConversationEvent, 0, len(messages))
		for index, message := range messages {
			eventSequence := sequence
			if index > 0 {
				eventSequence = s.nextLocalAppConversationSequence(anchorID)
			}
			events = append(events, &runtimev1.LocalAppConversationEvent{
				ConversationAnchorId: anchorID,
				Sequence:             eventSequence,
				Event: &runtimev1.LocalAppConversationEvent_MessageCommitted{MessageCommitted: &runtimev1.LocalAppConversationMessageCommitted{
					Message: message,
				}},
			})
		}
		return events, true, nil
	}
	if strings.TrimSpace(messageType) == publicChatTurnArtifactReadyType {
		artifactID, ok := localAppConversationMapString(detail, "artifact_id", false)
		if !ok || !validLocalAppConversationSelector(artifactID) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		artifact, err := s.localAppCommittedOutputArtifact(anchorID, turnID, artifactID)
		if err != nil {
			return nil, true, err
		}
		message := localAppConversationArtifactMessage(turnID, *artifact)
		messageEvent := &runtimev1.LocalAppConversationEvent{
			ConversationAnchorId: anchorID,
			Sequence:             sequence,
			Event: &runtimev1.LocalAppConversationEvent_MessageCommitted{MessageCommitted: &runtimev1.LocalAppConversationMessageCommitted{
				Message: message,
			}},
		}
		artifactSequence := s.nextLocalAppConversationSequence(anchorID)
		actionID, ok := localAppConversationMapString(detail, "action_id", false)
		if !ok || !validLocalAppConversationSelector(actionID) || artifactSequence == 0 {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		artifactEvent := &runtimev1.LocalAppConversationEvent{
			ConversationAnchorId: anchorID,
			Sequence:             artifactSequence,
			Event: &runtimev1.LocalAppConversationEvent_ArtifactReady{ArtifactReady: &runtimev1.LocalAppConversationArtifactReady{
				TurnId:              turnID,
				ActionId:            actionID,
				CapabilityContract:  "image.generate",
				ProjectionMessageId: message.GetMessageId(),
				ArtifactId:          artifactID,
			}},
		}
		return []*runtimev1.LocalAppConversationEvent{messageEvent, artifactEvent}, true, nil
	}
	event := &runtimev1.LocalAppConversationEvent{
		ConversationAnchorId: anchorID,
		Sequence:             sequence,
	}
	switch strings.TrimSpace(messageType) {
	case publicChatTurnAcceptedType:
		event.Event = &runtimev1.LocalAppConversationEvent_TurnAccepted{TurnAccepted: &runtimev1.LocalAppConversationTurnAccepted{
			TurnId: turnID,
		}}
	case publicChatTurnStartedType:
		event.Event = &runtimev1.LocalAppConversationEvent_TurnStarted{TurnStarted: &runtimev1.LocalAppConversationTurnStarted{TurnId: turnID}}
	case publicChatTurnActionPlannedType, publicChatTurnActionStartedType,
		publicChatTurnActionCompletedType, publicChatTurnActionFailedType:
		action, err := localAppConversationActionFromEvent(messageType, turnID, detail)
		if err != nil {
			return nil, true, err
		}
		wrapped := &runtimev1.LocalAppConversationActionEvent{Action: action}
		switch strings.TrimSpace(messageType) {
		case publicChatTurnActionPlannedType:
			event.Event = &runtimev1.LocalAppConversationEvent_ActionPlanned{ActionPlanned: wrapped}
		case publicChatTurnActionStartedType:
			event.Event = &runtimev1.LocalAppConversationEvent_ActionStarted{ActionStarted: wrapped}
		case publicChatTurnActionCompletedType:
			event.Event = &runtimev1.LocalAppConversationEvent_ActionCompleted{ActionCompleted: wrapped}
		case publicChatTurnActionFailedType:
			event.Event = &runtimev1.LocalAppConversationEvent_ActionFailed{ActionFailed: wrapped}
		}
	case publicChatTurnVoiceReadyType, publicChatTurnVoiceFailedType:
		voice := s.localAppConversationVoiceForTurn(anchorID, turnID)
		if voice == nil || (messageType == publicChatTurnVoiceReadyType) != (voice.State == "ready") {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		wrapped := &runtimev1.LocalAppConversationVoiceEvent{Voice: localAppConversationVoiceFromState(voice)}
		if voice.State == "ready" {
			event.Event = &runtimev1.LocalAppConversationEvent_VoiceReady{VoiceReady: wrapped}
		} else {
			event.Event = &runtimev1.LocalAppConversationEvent_VoiceFailed{VoiceFailed: wrapped}
		}
	case publicChatTurnCompletedType:
		reason, ok := localAppConversationMapString(detail, "terminal_reason", true)
		if !ok || !validLocalAppConversationTerminalReason(reason) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnCompleted{TurnCompleted: &runtimev1.LocalAppConversationTurnCompleted{
			TurnId: turnID, TerminalReason: reason,
		}}
	case publicChatTurnFailedType:
		reasonCode, ok := localAppConversationMapString(detail, "reason_code", false)
		if !ok || !validLocalAppConversationReasonCode(reasonCode) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		failed := &runtimev1.LocalAppConversationTurnFailed{TurnId: turnID, ReasonCode: reasonCode}
		if message, present := detail["message"]; present {
			value, ok := message.(string)
			if !ok || !validLocalAppConversationText(value, 1024, true) {
				return nil, true, localAppConversationOwnerUnavailable()
			}
			failed.Message = &value
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnFailed{TurnFailed: failed}
	case publicChatTurnInterruptedType:
		reason, ok := localAppConversationMapString(detail, "reason", false)
		if !ok || !validLocalAppConversationInterruptReason(reason) {
			return nil, true, localAppConversationOwnerUnavailable()
		}
		event.Event = &runtimev1.LocalAppConversationEvent_TurnInterrupted{TurnInterrupted: &runtimev1.LocalAppConversationTurnInterrupted{
			TurnId: turnID, Reason: reason,
		}}
	}
	return []*runtimev1.LocalAppConversationEvent{event}, true, nil
}

func validLocalAppAgentHandle(value string) bool {
	if len(value) != len(localAppAgentHandlePrefix)+43 || !strings.HasPrefix(value, localAppAgentHandlePrefix) {
		return false
	}
	for _, value := range value[len(localAppAgentHandlePrefix):] {
		if !((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
			(value >= '0' && value <= '9') || value == '-' || value == '_') {
			return false
		}
	}
	return true
}

func validLocalAppConversationSelector(value string) bool {
	return value != "" && value == strings.TrimSpace(value) &&
		len(value) <= localAppConversationMaxSelectorBytes && utf8.ValidString(value) &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func validLocalAppConversationText(value string, maxBytes int, allowOuterWhitespace bool) bool {
	if value == "" || len(value) > maxBytes || !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') {
		return false
	}
	if !allowOuterWhitespace && value != strings.TrimSpace(value) {
		return false
	}
	return strings.TrimSpace(value) != ""
}

func validLocalAppConversationTerminalReason(value string) bool {
	switch value {
	case "", "stop", "length", "tool_call", "content_filter", "error", "unspecified":
		return true
	default:
		return false
	}
}

func validLocalAppConversationInterruptReason(value string) bool {
	switch value {
	case "user_cancel", "room_closed", "superseded_turn", "budget_exhausted", "timeout", "gateway_revoked", "policy_refusal":
		return true
	default:
		return false
	}
}

func validLocalAppConversationReasonCode(value string) bool {
	if value == "" || len(value) > 128 || value != strings.TrimSpace(value) {
		return false
	}
	for _, value := range value {
		if !((value >= 'A' && value <= 'Z') || (value >= '0' && value <= '9') || value == '_' || value == '-') {
			return false
		}
	}
	return true
}

func localAppConversationMapString(input map[string]any, key string, optional bool) (string, bool) {
	value, present := input[key]
	if !present {
		return "", optional
	}
	text, ok := value.(string)
	return text, ok
}

func localAppConversationSequence(value any) (uint64, bool) {
	switch typed := value.(type) {
	case uint64:
		return typed, typed > 0
	case int64:
		return uint64(typed), typed > 0
	case int:
		return uint64(typed), typed > 0
	case float64:
		converted := uint64(typed)
		return converted, typed > 0 && float64(converted) == typed
	default:
		return 0, false
	}
}

func localAppConversationInvalid(message string) error {
	return grpcerr.WrapWithReasonCode(
		codes.InvalidArgument,
		runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		status.Error(codes.InvalidArgument, message),
		grpcerr.ReasonOptions{Message: message},
	)
}

func localAppConversationOwnerUnavailable() error {
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
}
