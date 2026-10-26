package runtimeagent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/url"
	"reflect"
	"strings"
	"time"
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
		s.logger.WarnContext(ctx, "agent introduction source snapshot unavailable", "found", found, "error", err)
		return nil, localAppConversationOwnerUnavailable()
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		s.logger.WarnContext(ctx, "agent introduction profile invalid", "error", err)
		return nil, localAppConversationOwnerUnavailable()
	}
	world, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core)
	if err != nil {
		s.logger.WarnContext(ctx, "agent introduction world invalid", "error", err)
		return nil, localAppConversationOwnerUnavailable()
	}
	public, err := s.realmCharacterPublicIntroduction.ResolveRealmCharacterPublicIntroduction(ctx, resolved.decision.AccountID, accountRealmCharacterPublicAvatarSourceRef(snapshot.Semantic.SourceRef))
	if err != nil || public == nil {
		s.logger.WarnContext(ctx, "agent introduction public source unavailable", "error", err)
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
		WorldName:              introductionText(&public.WorldName, 256),
		Era:                    introductionText(world.Identity.Era, 256),
		Role:                   introductionText(public.Role, 256),
		Greeting:               introductionText(profile.InteractionProfile.Greeting, 4096),
		ReferenceImageUrl:      introductionMediaURL(public.ReferenceImageURL),
		VoiceSampleUrl:         introductionOriginalMediaURL(public.VoiceSampleURL, public.VoiceSampleContentHash),
		VoicePreviewUrl:        introductionMediaURL(public.VoicePreviewURL),
		VoiceSampleContentHash: public.VoiceSampleContentHash,
		VoiceSampleMimeType:    public.VoiceSampleMimeType,
	}
	if result.VoiceSampleUrl == nil {
		result.VoiceSampleContentHash = nil
		result.VoiceSampleMimeType = nil
	}
	if (result.VoiceSampleUrl != nil || result.VoicePreviewUrl != nil) && public.VoiceSampleDurationSec != nil {
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

// A reference-audio capability is short lived and hash-bound; it is not an account token.
func introductionOriginalMediaURL(value, contentHash *string) *string {
	if value == nil {
		return nil
	}
	if safeLocalAppAgentAvatarURL(*value) {
		return value
	}
	if contentHash == nil || len(*contentHash) != 64 || strings.ToLower(*contentHash) != *contentHash {
		return nil
	}
	if decoded, err := hex.DecodeString(*contentHash); err != nil || len(decoded) != 32 {
		return nil
	}
	parsed, err := url.Parse(*value)
	if err != nil {
		return nil
	}
	query := parsed.Query()
	if len(query) != 1 || len(query["grant"]) != 1 {
		return nil
	}
	pieces := strings.Split(query.Get("grant"), ".")
	if len(pieces) != 2 {
		return nil
	}
	signature, err := base64.RawURLEncoding.DecodeString(pieces[1])
	if err != nil || len(signature) != 32 {
		return nil
	}
	body, err := base64.RawURLEncoding.DecodeString(pieces[0])
	if err != nil {
		return nil
	}
	var grant struct {
		V        int      `json:"v"`
		Aud      string   `json:"aud"`
		Env      string   `json:"env"`
		Sub      string   `json:"sub"`
		Ver      string   `json:"ver"`
		Gen      int      `json:"gen"`
		Purposes []string `json:"purposes"`
		Iat      int64    `json:"iat"`
		Exp      int64    `json:"exp"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&grant) != nil {
		return nil
	}
	parts := strings.Split(strings.TrimPrefix(parsed.Path, "/"), "/")
	if len(parts) != 5 || parts[0] != "m" || parts[2] != *contentHash || parts[3] != "v1" || parts[4] != "original.bin" || grant.Sub != parts[1] || grant.Ver != *contentHash || grant.V != 1 || grant.Aud != "nimi-media" || (grant.Env != "preview" && grant.Env != "production") || grant.Gen < 1 || grant.Exp <= grant.Iat || grant.Exp-grant.Iat > 300 || grant.Exp < time.Now().Unix() || grant.Iat > time.Now().Unix()+30 {
		return nil
	}
	allowed := false
	for _, purpose := range grant.Purposes {
		if purpose == "original" {
			allowed = true
		}
	}
	if !allowed {
		return nil
	}
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	if !safeLocalAppAgentAvatarURL(parsed.String()) {
		return nil
	}
	return value
}
