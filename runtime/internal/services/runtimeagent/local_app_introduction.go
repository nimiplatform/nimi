package runtimeagent

import (
	"context"
	"math"
	"reflect"
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type realmCharacterPublicIntroductionResolver interface {
	ResolveRealmCharacterPublicIntroduction(context.Context, string, accountservice.RealmSourceMaterializationSourceRefV3) (*accountservice.RealmCharacterPublicIntroduction, error)
}

func (s *Service) SetRealmCharacterPublicIntroductionResolver(resolver realmCharacterPublicIntroductionResolver) {
	s.realmCharacterPublicIntroduction = resolver
}

// @nimi-authority: rule.nimi.runtime.agent-participation.agent-introduction
func (s *Service) GetLocalAppAgentIntroduction(ctx context.Context, req *runtimev1.GetLocalAppAgentIntroductionRequest) (*runtimev1.GetLocalAppAgentIntroductionResponse, error) {
	if req == nil {
		return nil, localAppAgentAccessDenied()
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, localappop.OperationAgentIntroductionGet, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	if s.publicChatSourceSnapshotResolve == nil || s.realmCharacterPublicIntroduction == nil || s.localAppIngressRevalidator == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	snapshot, found, err := s.publicChatSourceSnapshotResolve(ctx, resolved.identity.LocalAgentRef)
	if err != nil || !found || snapshot.LocalAgentRef != resolved.identity.LocalAgentRef || snapshot.Semantic.SourceRef.validate() != nil ||
		localAppAgentCurrentSourceHash(resolved.entry) != snapshot.Semantic.SourceRef.SourceHash {
		return nil, localAppConversationOwnerUnavailable()
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	world, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	public, err := s.realmCharacterPublicIntroduction.ResolveRealmCharacterPublicIntroduction(ctx, resolved.decision.AccountID, accountRealmCharacterPublicAvatarSourceRef(snapshot.Semantic.SourceRef))
	if err != nil || public == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	// Network reads may outlive admission or a source replacement. Revalidate
	// both the protected session and current owner snapshot before disclosure.
	currentCtx, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(ctx, localappop.IngressAgentIntroductionGet)
	if err != nil {
		return nil, err
	}
	current, _, err := s.resolveLocalAppAgent(currentCtx, localappop.OperationAgentIntroductionGet, req.GetAgentHandle())
	if err != nil {
		return nil, err
	}
	latest, found, err := s.publicChatSourceSnapshotResolve(currentCtx, current.identity.LocalAgentRef)
	if err != nil || !found || current.identity != resolved.identity ||
		latest.SnapshotHash != snapshot.SnapshotHash ||
		!reflect.DeepEqual(latest.Semantic.SourceRef, snapshot.Semantic.SourceRef) ||
		localAppAgentCurrentSourceHash(current.entry) != snapshot.Semantic.SourceRef.SourceHash {
		return nil, localAppConversationOwnerUnavailable()
	}
	result := &runtimev1.LocalAppAgentIntroduction{
		WorldName:         introductionText(&public.WorldName, 256),
		Era:               introductionText(world.Identity.Era, 256),
		Role:              introductionText(public.Role, 256),
		Greeting:          introductionText(profile.InteractionProfile.Greeting, 4096),
		ReferenceImageUrl: introductionMediaURL(public.ReferenceImageURL),
		VoiceSampleUrl:    introductionMediaURL(public.VoiceSampleURL),
	}
	if result.VoiceSampleUrl != nil && public.VoiceSampleDurationSec != nil {
		duration := *public.VoiceSampleDurationSec
		if !math.IsNaN(duration) && !math.IsInf(duration, 0) && duration > 0 {
			result.VoiceSampleDurationSec = &duration
		}
	}
	seen := map[string]bool{}
	add := func(kind runtimev1.LocalAppAgentIntroductionTopicKind, value *string) {
		text := introductionText(value, 256)
		if text == nil || seen[*text] || len(result.QuestionTopics) >= 16 {
			return
		}
		seen[*text] = true
		result.QuestionTopics = append(result.QuestionTopics, &runtimev1.LocalAppAgentIntroductionTopic{Kind: kind, Text: *text})
	}
	add(runtimev1.LocalAppAgentIntroductionTopicKind_LOCAL_APP_AGENT_INTRODUCTION_TOPIC_KIND_ROLE, result.Role)
	add(runtimev1.LocalAppAgentIntroductionTopicKind_LOCAL_APP_AGENT_INTRODUCTION_TOPIC_KIND_TOPIC, profile.Narrative.Archetype)
	if profile.Narrative.Traits != nil {
		for _, value := range *profile.Narrative.Traits {
			add(runtimev1.LocalAppAgentIntroductionTopicKind_LOCAL_APP_AGENT_INTRODUCTION_TOPIC_KIND_TOPIC, &value)
		}
	}
	for _, value := range public.Works {
		add(runtimev1.LocalAppAgentIntroductionTopicKind_LOCAL_APP_AGENT_INTRODUCTION_TOPIC_KIND_WORK, &value)
	}
	for _, value := range public.Relationships {
		add(runtimev1.LocalAppAgentIntroductionTopicKind_LOCAL_APP_AGENT_INTRODUCTION_TOPIC_KIND_RELATIONSHIP, &value)
	}
	for _, value := range public.Topics {
		add(runtimev1.LocalAppAgentIntroductionTopicKind_LOCAL_APP_AGENT_INTRODUCTION_TOPIC_KIND_TOPIC, &value)
	}
	return &runtimev1.GetLocalAppAgentIntroductionResponse{Introduction: result}, nil
}

func introductionText(value *string, limit int) *string {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	if text == "" || !utf8.ValidString(text) || len(text) > limit || strings.ContainsFunc(text, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }) {
		return nil
	}
	return &text
}

func introductionMediaURL(value *string) *string {
	if value == nil || !safeLocalAppAgentAvatarURL(*value) {
		return nil
	}
	return value
}
