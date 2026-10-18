package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

// Only in-flight work lives here. Durable request claims prevent replay after restart.
type localAppVoiceRenderFlight struct {
	done chan struct{}
	err  error
}

func cloneVoiceRenderRequests(input map[string]string) map[string]string {
	if input == nil {
		return nil
	}
	result := make(map[string]string, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r181
func (s *Service) admitLocalAppVoiceRender(anchorID, turnID, requestKey string) (*localAppVoiceRenderFlight, bool, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil || s.agentTerminationFencedLocked(anchor.LocalAgentRef) {
		return nil, false, localAppConversationOwnerUnavailable()
	}
	if existing := anchor.VoiceSidecars[turnID]; existing != nil && existing.State == "ready" {
		return nil, false, nil
	}
	flightKey := anchorID + "\x00" + turnID
	flight := s.chatVoiceRenders[flightKey]
	if claimedTurn, ok := anchor.VoiceRenderRequests[requestKey]; ok {
		if claimedTurn != turnID {
			return nil, false, localAppConversationInvalid("voice request id reused for another message")
		}
		return flight, false, nil
	}
	before := cloneVoiceRenderRequests(anchor.VoiceRenderRequests)
	versionBefore := s.chatSurfaceVersion
	if anchor.VoiceRenderRequests == nil {
		anchor.VoiceRenderRequests = make(map[string]string)
	}
	anchor.VoiceRenderRequests[requestKey] = turnID
	if err := s.persistPublicChatSurfaceStateLocked(anchorID); err != nil {
		anchor.VoiceRenderRequests = before
		s.chatSurfaceVersion = versionBefore
		return nil, false, localAppConversationOwnerUnavailable()
	}
	if flight != nil {
		return flight, false, nil
	}
	flight = &localAppVoiceRenderFlight{done: make(chan struct{})}
	if s.chatVoiceRenders == nil {
		s.chatVoiceRenders = make(map[string]*localAppVoiceRenderFlight)
	}
	s.chatVoiceRenders[flightKey] = flight
	return flight, true, nil
}

func (s *Service) finishLocalAppVoiceRender(anchorID, turnID string, flight *localAppVoiceRenderFlight, err error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	flight.err = err
	delete(s.chatVoiceRenders, anchorID+"\x00"+turnID)
	close(flight.done)
}

func (s *Service) revalidateLocalAppVoiceRender(ctx context.Context, req *runtimev1.RenderLocalAppConversationVoiceRequest, initial localAppAgentIdentity) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.localAppIngressRevalidator == nil {
		return localAppConversationOwnerUnavailable()
	}
	ownerCtx, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(ctx, localappop.IngressConversationVoiceRender)
	if err != nil {
		return err
	}
	current, _, err := s.resolveLocalAppAgent(ownerCtx, accountservice.LocalAppOperationConversationVoiceRender, req.GetAgentHandle())
	if err != nil {
		return err
	}
	if current.decision.SessionID != initial.decision.SessionID || current.decision.AccountID != initial.decision.AccountID ||
		current.decision.RegisteredAppSubject != initial.decision.RegisteredAppSubject || current.identity.LocalAgentRef != initial.identity.LocalAgentRef {
		return localAppAgentAccessDenied()
	}
	return s.validateLocalAppConversationResource(current, strings.TrimSpace(req.GetConversationAnchorId()))
}

func (s *Service) currentLocalAppVoiceRenderResponse(resolved localAppAgentIdentity, anchorID, turnID string) (*runtimev1.RenderLocalAppConversationVoiceResponse, error) {
	voice := s.localAppConversationVoiceForTurn(anchorID, turnID)
	if voice == nil {
		return nil, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	return s.localAppConversationVoiceRenderResponse(resolved.identity.LocalAgentRef, anchorID, voice)
}

// A manual render uses the existing Account and technical-session commit fence.
// Session identity authorizes now; stable registered App identity scopes durable request deduplication.
type localAppVoiceRenderCommit struct {
	ctx      context.Context
	initial  localAppAgentIdentity
	previous *publicChatVoiceSidecarState
}

func (s *Service) persistLocalAppVoiceRenderCommitLocked(attempt *localAppVoiceRenderCommit, anchorID string) error {
	if attempt == nil {
		return s.persistPublicChatSurfaceStateLocked(anchorID)
	}
	return s.persistLocalAppConversationCommitLocked(attempt.ctx, localappop.IngressConversationVoiceRender, attempt.initial.decision, anchorID)
}
