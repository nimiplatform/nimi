package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/encoding/protojson"
)

type introductionResolverFunc func(context.Context, string, accountservice.RealmSourceMaterializationSourceRefV3) (*accountservice.RealmCharacterPublicIntroduction, error)

func TestLocalAppIntroductionMediaRejectsBrowserLocalHostAliases(t *testing.T) {
	for _, value := range []string{
		"https://127.1/media.png", "https://2130706433/media.png", "https://0x7f000001/media.png",
		"https://0177.0.0.1/media.png", "https://127。0。0。1/media.png", "https://0x/media.png",
		"https://localhost./media.png", "https://private.internal./voice.mp3", "https://ｌｏｃａｌｈｏｓｔ/media.png",
		"https://cdn.example.test/im\nage.png", "https://cdn.example.test/im\u0085age.png", "https://[fe80::1%25en0]/media.png",
	} {
		if safeLocalAppAgentAvatarURL(value) || introductionMediaURL(&value) != nil {
			t.Errorf("unsafe media projected: %q", value)
		}
	}
	for _, value := range []string{"https://cdn.example.test/media.png", "https://cdn.example.test./voice.mp3", "https://bücher.example/image.png"} {
		if !safeLocalAppAgentAvatarURL(value) {
			t.Errorf("safe media rejected: %q", value)
		}
	}
}

func (f introductionResolverFunc) ResolveRealmCharacterPublicIntroduction(ctx context.Context, account string, source accountservice.RealmSourceMaterializationSourceRefV3) (*accountservice.RealmCharacterPublicIntroduction, error) {
	return f(ctx, account, source)
}

func TestLocalAppAgentIntroductionUsesCurrentOwnedSourceWithoutConversation(t *testing.T) {
	for _, kind := range []string{"world-character", "persona-character"} {
		t.Run(kind, func(t *testing.T) {
			verified := verifiedRealmSourceMaterializationVectorV3(t, kind)
			snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, realmSourceMaterializationProductTestLocalAgentRef("introduction"))
			if err != nil {
				t.Fatal(err)
			}
			svc := localAppAgentOwnershipAvatarService(snapshot)
			svc.agents[snapshot.LocalAgentRef].Agent.RuntimeSourceRef = "realm-character:introduction"
			decision := localAppReferenceDecision(0x71, "acct-1")
			decision.Operation = localappop.OperationAgentIntroductionGet
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
			handle := mintLocalAppAgentHandle(decision, snapshot.LocalAgentRef)
			svc.localAppIngressRevalidator = localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
				if ingress != localappop.IngressAgentIntroductionGet {
					t.Fatal("wrong admission")
				}
				return ctx, nil
			})
			role, image, unsafeVoice := "清代学者", "https://cdn.example.test/full.png", "https://cdn.example.test/voice?token=private"
			svc.SetRealmCharacterPublicIntroductionResolver(introductionResolverFunc(func(_ context.Context, account string, source accountservice.RealmSourceMaterializationSourceRefV3) (*accountservice.RealmCharacterPublicIntroduction, error) {
				if account != "acct-1" || source.SourceHash != snapshot.Semantic.SourceRef.SourceHash {
					t.Fatal("source mismatch")
				}
				return &accountservice.RealmCharacterPublicIntroduction{WorldName: "清代", Role: &role, ReferenceImageURL: &image, VoiceSampleURL: &unsafeVoice, Works: []string{"潜研堂集"}}, nil
			}))
			response, err := svc.GetLocalAppAgentIntroduction(ctx, &runtimev1.GetLocalAppAgentIntroductionRequest{AgentHandle: handle})
			if err != nil {
				t.Fatal(err)
			}
			intro := response.GetIntroduction()
			if intro.GetRole() != role || intro.GetReferenceImageUrl() != image || intro.VoiceSampleUrl != nil || len(intro.QuestionTopics) == 0 {
				t.Fatalf("unexpected projection: %v", intro)
			}
			payload, _ := protojson.Marshal(response)
			for _, secret := range []string{snapshot.LocalAgentRef, snapshot.Semantic.SourceRef.SourceHash, "sourceRef", "accountId", "token=private"} {
				if strings.Contains(string(payload), secret) {
					t.Fatalf("private material in projection: %s", secret)
				}
			}
			if len(svc.chatAnchors) != 0 {
				t.Fatal("introduction opened a conversation")
			}
			for _, invalid := range []string{snapshot.LocalAgentRef, "agent_ref_" + strings.Repeat("Z", 43)} {
				if _, err := svc.GetLocalAppAgentIntroduction(ctx, &runtimev1.GetLocalAppAgentIntroductionRequest{AgentHandle: invalid}); err == nil {
					t.Fatal("invalid handle admitted")
				}
			}
			svc.localAppIngressRevalidator = localAppIngressRevalidatorFunc(func(context.Context, localappop.Ingress) (context.Context, error) {
				return nil, errors.New("session revoked")
			})
			if _, err := svc.GetLocalAppAgentIntroduction(ctx, &runtimev1.GetLocalAppAgentIntroductionRequest{AgentHandle: handle}); err == nil {
				t.Fatal("revoked session disclosed introduction")
			}
			svc.localAppIngressRevalidator = localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
				svc.agents[snapshot.LocalAgentRef].Agent.SourceContextStatus = nil
				return ctx, nil
			})
			if _, err := svc.GetLocalAppAgentIntroduction(ctx, &runtimev1.GetLocalAppAgentIntroductionRequest{AgentHandle: handle}); err == nil {
				t.Fatal("changed source disclosed introduction")
			}
		})
	}
}
