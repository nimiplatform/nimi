package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type discoveryFence struct {
	decision   accountservice.LocalAppCallerDecision
	denyCommit bool
}

func (f discoveryFence) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	classification, err := localappop.ClassifyIngress(ingress)
	if err != nil {
		return nil, err
	}
	decision := f.decision
	decision.Operation = classification.Operation
	decision.OperationCapability = string(classification.Domain)
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
}
func (f discoveryFence) CommitLocalAppIngress(ctx context.Context, ingress localappop.Ingress, commit func(context.Context) error) error {
	if f.denyCommit {
		return status.Error(codes.PermissionDenied, "revoked")
	}
	current, err := f.AuthorizeLocalAppIngress(ctx, ingress)
	if err != nil {
		return err
	}
	return commit(current)
}

func TestCharacterAcquisitionCreatesThenReusesStablePartnerWithoutReplacingSnapshot(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	_, source := realmSourceMaterializationServiceTestRequest(t, "world-character", "source")
	decision := localAppReferenceDecision(0x31, source.Context.OwnerUserId)
	decision.AccountGeneration = 1
	fence := discoveryFence{decision: decision}
	svc.localAppIngressRevalidator = fence
	ctx, _ := fence.AuthorizeLocalAppIngress(context.Background(), localappop.IngressCharacterSourceConnect)
	first, err := svc.ConnectLocalAppCharacterSource(ctx, &runtimev1.ConnectLocalAppCharacterSourceRequest{SourceRef: source.SourceRef, RequestId: "first"})
	if err != nil || !first.GetCreated() || first.GetPartner() == nil {
		t.Fatalf("create: %v %v", first, err)
	}
	revised := proto.Clone(source.SourceRef).(*runtimev1.CharacterSourceRefV3)
	revised.GetWorldCharacter().SourceHash = strings.Repeat("b", 64)
	second, err := svc.ConnectLocalAppCharacterSource(ctx, &runtimev1.ConnectLocalAppCharacterSourceRequest{SourceRef: revised, RequestId: "second"})
	if err != nil || second.GetCreated() || !proto.Equal(first.Partner, second.Partner) {
		t.Fatalf("reuse: %v %v", second, err)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 1, 1, 0)
	refs, err := svc.ListOwnedActiveLocalAgents(context.Background(), decision.AccountID)
	if err != nil || len(refs) != 1 {
		t.Fatalf("inventory: %v %v", refs, err)
	}
	entry, _ := svc.agentByID(refs[0].LocalAgentID)
	if !proto.Equal(entry.Agent.GetSourceContextStatus().GetSourceRef(), source.SourceRef) {
		t.Fatal("reuse changed original source snapshot")
	}
}

func TestCharacterAcquisitionRequiresSeparateDomainAndCurrentCommitScope(t *testing.T) {
	svc, issuer, closeService := openRealmSourceMaterializationServiceTest(t, "world-character")
	defer closeService()
	_, source := realmSourceMaterializationServiceTestRequest(t, "world-character", "source")
	decision := localAppReferenceDecision(0x31, source.Context.OwnerUserId)
	request := &runtimev1.ConnectLocalAppCharacterSourceRequest{SourceRef: source.SourceRef, RequestId: "denied"}
	if _, err := svc.ConnectLocalAppCharacterSource(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), request); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("interaction access acquired partner: %v", err)
	}
	assertRealmSourceMaterializationIssuerCalls(t, issuer, 0, 0, 0)
	decision.AccountGeneration = 1
	fence := discoveryFence{decision: decision, denyCommit: true}
	svc.localAppIngressRevalidator = fence
	ctx, _ := fence.AuthorizeLocalAppIngress(context.Background(), localappop.IngressCharacterSourceConnect)
	if _, err := svc.ConnectLocalAppCharacterSource(ctx, request); err == nil {
		t.Fatal("revoked acquisition succeeded")
	}
	refs, err := svc.ListOwnedActiveLocalAgents(context.Background(), decision.AccountID)
	if err != nil || len(refs) != 0 {
		t.Fatalf("revoked acquisition published: %v %v", refs, err)
	}
}
