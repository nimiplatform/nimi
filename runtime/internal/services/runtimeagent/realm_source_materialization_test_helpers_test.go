package runtimeagent

import (
	"context"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"fmt"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const sourceMaterializationTransportTestRuntimeID = "runtime-instance-materializer-1"

type realmSourceTestAgentInput struct {
	Context          *runtimev1.AgentRequestContext
	LocalAgentRef    string
	OwnerUserId      string
	RuntimeSourceRef string
	WorldId          string
	AutonomyConfig   *runtimev1.AgentAutonomyConfig
}

type realmSourceTestAgentResult struct {
	agent *runtimev1.LocalAgentRecord
}

func (r *realmSourceTestAgentResult) GetAgent() *runtimev1.LocalAgentRecord {
	if r == nil {
		return nil
	}
	return r.agent
}

// materializeRealmSourceTestAgent creates test state through the same verified
// Realm Source product commit used by the public MaterializeRealmSource path.
// The caller's runtime source text is only a stable fixture key for choosing a
// LocalAgent ref; it is never admitted as product source identity.
func materializeRealmSourceTestAgent(
	t *testing.T,
	svc *Service,
	ctx context.Context,
	input *realmSourceTestAgentInput,
) (*realmSourceTestAgentResult, error) {
	t.Helper()
	if svc == nil || input == nil || input.Context == nil {
		return nil, status.Error(codes.InvalidArgument, "Realm Source test materialization context is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ownerUserID := firstNonEmpty(
		strings.TrimSpace(input.OwnerUserId),
		strings.TrimSpace(input.Context.GetOwnerUserId()),
		strings.TrimSpace(input.Context.GetSubjectUserId()),
	)
	if ownerUserID == "" {
		return nil, status.Error(codes.InvalidArgument, "owner_user_id is required")
	}
	fixtureKey := firstNonEmpty(
		strings.TrimSpace(input.RuntimeSourceRef),
		strings.TrimSpace(input.Context.GetRuntimeSourceRef()),
		strings.TrimSpace(input.LocalAgentRef),
		strings.TrimSpace(input.Context.GetLocalAgentRef()),
	)
	localAgentRef := firstNonEmpty(
		strings.TrimSpace(input.LocalAgentRef),
		strings.TrimSpace(input.Context.GetLocalAgentRef()),
	)
	if localAgentRef == "" {
		localAgentRef = testOpaqueLocalAgentRef(ownerUserID, fixtureKey)
	}
	if !strings.HasPrefix(localAgentRef, runtimeGeneratedLocalAgentRefPrefix) {
		return nil, status.Error(codes.InvalidArgument, "Realm Source materialization requires a Runtime-minted local_agent_ref")
	}

	verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
	verified.Packet.MaterializerAccountID = ownerUserID
	packetHash, err := sourceMaterializationPacketHashV3(verified.Packet)
	if err != nil {
		return nil, fmt.Errorf("rehash Realm Source test packet: %w", err)
	}
	verified.Packet.PacketHash = packetHash
	runtimeSourceRef, err := runtimeSourceRefForRealmSourceV3(verified.Packet.SourceRef)
	if err != nil {
		return nil, fmt.Errorf("derive Realm Source test identity: %w", err)
	}
	input.Context.OwnerUserId = ownerUserID
	if strings.TrimSpace(input.Context.GetSubjectUserId()) == "" {
		input.Context.SubjectUserId = ownerUserID
	}
	input.Context.RuntimeSourceRef = runtimeSourceRef
	input.Context.LocalAgentRef = localAgentRef

	if existing, existingErr := svc.agentByID(localAgentRef); existingErr == nil {
		if err := validateLocalAgentRecordIdentity(existing.Agent, localAgentIdentity{
			OwnerUserID:      ownerUserID,
			RuntimeSourceRef: runtimeSourceRef,
			LocalAgentRef:    localAgentRef,
		}); err != nil {
			return nil, err
		}
		if err := configureRealmSourceTestAgent(ctx, svc, input); err != nil {
			return nil, err
		}
		refreshed, err := svc.agentByID(localAgentRef)
		if err != nil {
			return nil, err
		}
		return &realmSourceTestAgentResult{agent: cloneLocalAgentRecord(refreshed.Agent)}, nil
	} else if status.Code(existingErr) != codes.NotFound {
		return nil, existingErr
	}

	prepared, _, err := svc.prepareRealmSourceMaterializationProductV3(
		ctx,
		ownerUserID,
		localAgentRef,
		verified,
	)
	if err != nil {
		return nil, err
	}
	if err := svc.backend.WriteTx(ctx, prepared.commitTx); err != nil {
		prepared.rolledBack()
		return nil, err
	}
	prepared.committed()

	if err := configureRealmSourceTestAgent(ctx, svc, input); err != nil {
		return nil, err
	}
	entry, err := svc.agentByID(localAgentRef)
	if err != nil {
		return nil, err
	}
	return &realmSourceTestAgentResult{agent: cloneLocalAgentRecord(entry.Agent)}, nil
}

func configureRealmSourceTestAgent(ctx context.Context, svc *Service, input *realmSourceTestAgentInput) error {
	if input.AutonomyConfig != nil {
		if _, err := svc.SetAutonomyConfig(ctx, &runtimev1.SetAutonomyConfigRequest{
			Context: input.Context,
			Config:  input.AutonomyConfig,
		}); err != nil {
			return err
		}
	}
	if strings.TrimSpace(input.WorldId) != "" {
		if _, err := svc.UpdateAgentState(ctx, &runtimev1.UpdateAgentStateRequest{
			Context: input.Context,
			Mutations: []*runtimev1.AgentStateMutation{{
				Mutation: &runtimev1.AgentStateMutation_SetWorldContext{
					SetWorldContext: &runtimev1.AgentStateSetWorldContext{WorldId: strings.TrimSpace(input.WorldId)},
				},
			}},
		}); err != nil {
			return err
		}
	}
	return nil
}

func openSourceMaterializationTransportTestService(t *testing.T, localStatePath string) (*Service, func()) {
	t.Helper()
	memorySvc, err := memoryservice.New(nil, config.Config{LocalStatePath: localStatePath, AIHTTPTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("runtimeagent.New: %v", err)
	}
	if err := svc.SetSourceMaterializationRuntimeIdentity(sourceMaterializationTransportTestRuntimeID); err != nil {
		svc.Close()
		_ = memorySvc.Close()
		t.Fatalf("SetSourceMaterializationRuntimeIdentity: %v", err)
	}
	var once sync.Once
	closeFn := func() {
		once.Do(func() {
			svc.Close()
			if err := memorySvc.Close(); err != nil {
				t.Fatalf("memory.Close: %v", err)
			}
		})
	}
	return svc, closeFn
}

func sourceMaterializationTransportTestContext(accountID string) context.Context {
	return authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: accountID})
}

var (
	sourceMaterializationTestKey, sourceMaterializationTestKeyErr = rsa.GenerateKey(cryptorand.Reader, 2048)
)

func sourceMaterializationTestPrivateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	if sourceMaterializationTestKeyErr != nil {
		t.Fatalf("generate Realm source materialization test key: %v", sourceMaterializationTestKeyErr)
	}
	return sourceMaterializationTestKey
}
