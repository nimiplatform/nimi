package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type sourceMaterializationTransportBlockingAdmission struct {
	candidate localAgentSourceSnapshotCandidateV1
	started   chan struct{}
	release   chan struct{}
	once      sync.Once
}

func (a *sourceMaterializationTransportBlockingAdmission) VerifySourceMaterializationBegin(context.Context, *runtimev1.SourceMaterializationBeginControl, sourceMaterializationChallengeBindingV2, time.Time) error {
	return nil
}

func (a *sourceMaterializationTransportBlockingAdmission) AdmitSourceMaterializationCommit(context.Context, *runtimev1.SourceMaterializationBeginControl, sourceMaterializationChallengeBindingV2, map[string][]byte, time.Time) (localAgentSourceSnapshotCandidateV1, error) {
	a.once.Do(func() { close(a.started) })
	<-a.release
	return a.candidate, nil
}

func TestSourceMaterializationCommitAdmissionFailureRollsBackAndClearsRawBytes(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{commitErr: errors.New("deterministic admission rejection")})
	svc.SetSourceMaterializationProductCommitter(sourceMaterializationTransportTestRejectingCommitter{})
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, control, componentBytes := sourceMaterializationTransportTestChallengeAndControl(t, svc, ctx, "commit-reject")
	begin, err := svc.BeginSourceMaterializationUpload(ctx, &runtimev1.BeginSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), BeginRequestId: "begin-commit-reject", Control: control})
	if err != nil {
		t.Fatalf("begin rejected commit: %v", err)
	}
	if _, err := svc.PutSourceMaterializationChunk(ctx, sourceMaterializationTransportTestPutRequest(begin, control, componentBytes, "put-commit-reject")); err != nil {
		t.Fatalf("put rejected commit: %v", err)
	}
	commit, err := svc.CommitSourceMaterialization(ctx, &runtimev1.CommitSourceMaterializationRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), CommitRequestId: "commit-reject", UploadId: begin.GetUploadId(), PacketHash: begin.GetPacketHash(), BundleManifestHash: begin.GetBundleManifestHash()})
	if err != nil {
		t.Fatalf("commit rejection: %v", err)
	}
	if commit.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED || commit.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_INVALIDATED || commit.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_ADMISSION_FAILED {
		t.Fatalf("commit rejection response = %+v", commit)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())
	for _, table := range []string{"runtime_local_agent", "runtime_local_agent_source_snapshot", "runtime_local_agent_source_provenance"} {
		var count int
		if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s count after rejected commit = %d, want 0", table, count)
		}
	}
}

type sourceMaterializationTransportTestRejectingCommitter struct{}

func (sourceMaterializationTransportTestRejectingCommitter) PrepareSourceMaterializationProduct(context.Context, string, string, *runtimev1.SourceMaterializationSourceRef, localAgentSourceSnapshotV1) (sourceMaterializationPreparedProduct, error) {
	return nil, errors.New("product committer must not run after admission rejection")
}

type sourceMaterializationTransportTestCommitter struct {
	svc       *Service
	failTx    bool
	mu        sync.Mutex
	commits   int
	rollbacks int
}

func (c *sourceMaterializationTransportTestCommitter) PrepareSourceMaterializationProduct(_ context.Context, localAgentRef string, accountID string, _ *runtimev1.SourceMaterializationSourceRef, snapshot localAgentSourceSnapshotV1) (sourceMaterializationPreparedProduct, error) {
	if c == nil || c.svc == nil || localAgentRef != snapshot.LocalAgentRef {
		return nil, errors.New("invalid prepared source materialization product")
	}
	c.svc.mu.Lock()
	if c.svc.agents[localAgentRef] != nil {
		c.svc.mu.Unlock()
		return nil, errors.New("source materialization product already exists")
	}
	now, _ := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	entry := &agentEntry{
		Agent: &runtimev1.AgentRecord{AgentId: localAgentRef, LocalAgentRef: localAgentRef, OwnerUserId: accountID, RuntimeSourceRef: runtimeSourceRefForMaterialization(sourceMaterializationProtoRef(snapshot.SourceRef)), DisplayName: snapshot.SourceRef.SourceID, LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE, CreatedAt: timestamppb.New(now), UpdatedAt: timestamppb.New(now)},
		State: &runtimev1.AgentStateProjection{ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE, Attributes: map[string]string{}, UpdatedAt: timestamppb.New(now)},
		Hooks: make(map[string]*runtimev1.PendingHook),
	}
	return &sourceMaterializationTransportTestPreparedProduct{committer: c, snapshot: snapshot, accountID: accountID, entry: entry}, nil
}

func (c *sourceMaterializationTransportTestCommitter) counts() (int, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.commits, c.rollbacks
}

type sourceMaterializationTransportTestPreparedProduct struct {
	committer *sourceMaterializationTransportTestCommitter
	snapshot  localAgentSourceSnapshotV1
	accountID string
	entry     *agentEntry
	once      sync.Once
}

func (p *sourceMaterializationTransportTestPreparedProduct) CommitSourceMaterializationProductTx(tx *sql.Tx) error {
	if err := insertSourceMaterializationTestAgentTx(tx, p.snapshot, p.accountID); err != nil {
		return err
	}
	if p.committer.failTx {
		return errors.New("deterministic product transaction failure")
	}
	return nil
}

func (p *sourceMaterializationTransportTestPreparedProduct) SourceMaterializationProductCommitted() {
	p.once.Do(func() {
		p.committer.svc.agents[p.snapshot.LocalAgentRef] = cloneAgentEntry(p.entry)
		p.committer.svc.mu.Unlock()
		p.committer.mu.Lock()
		p.committer.commits++
		p.committer.mu.Unlock()
	})
}

func (p *sourceMaterializationTransportTestPreparedProduct) SourceMaterializationProductRolledBack() {
	p.once.Do(func() {
		p.committer.svc.mu.Unlock()
		p.committer.mu.Lock()
		p.committer.rollbacks++
		p.committer.mu.Unlock()
	})
}

func TestSourceMaterializationCommitAtomicallyCreatesCharacterAndPersona(t *testing.T) {
	for _, kind := range []string{"worldCharacter", "realmPersona"} {
		t.Run(kind, func(t *testing.T) {
			svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
			defer closeService()
			candidate := sourceMaterializationTransportTestCandidate(t, kind, "packet-transport-"+kind)
			committer := &sourceMaterializationTransportTestCommitter{svc: svc}
			svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{candidate: candidate})
			svc.SetSourceMaterializationProductCommitter(committer)
			ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
			challenge, _, _, begin := sourceMaterializationTransportTestBeginPutCandidate(t, svc, ctx, candidate, "atomic-"+kind)
			commitReq := &runtimev1.CommitSourceMaterializationRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), CommitRequestId: "commit-atomic-" + kind, UploadId: begin.GetUploadId(), PacketHash: begin.GetPacketHash(), BundleManifestHash: begin.GetBundleManifestHash()}
			committed, err := svc.CommitSourceMaterialization(ctx, commitReq)
			if err != nil {
				t.Fatalf("CommitSourceMaterialization: %v", err)
			}
			if committed.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED || committed.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED || committed.GetLocalAgentRef() == "" || !committed.GetSourceContextStatus().GetReady() {
				t.Fatalf("commit response = %+v", committed)
			}
			if committed.GetSourceContextStatus().GetSnapshotHash() != candidate.Normalized.SnapshotHash || !sameSourceMaterializationSourceRef(committed.GetSourceContextStatus().GetSourceRef(), challenge.GetSourceRef()) {
				t.Fatalf("commit source status = %+v", committed.GetSourceContextStatus())
			}
			if _, err := svc.agentByID(committed.GetLocalAgentRef()); err != nil {
				t.Fatalf("committed agent is not visible: %v", err)
			}
			snapshot, found, err := svc.sourceMaterializationRepo.sourceSnapshot(context.Background(), committed.GetLocalAgentRef())
			if err != nil || !found || snapshot.SnapshotHash != candidate.Normalized.SnapshotHash {
				t.Fatalf("committed snapshot: found=%v snapshot=%+v err=%v", found, snapshot, err)
			}
			replay, err := svc.CommitSourceMaterialization(ctx, commitReq)
			if err != nil {
				t.Fatalf("commit replay: %v", err)
			}
			if replay.GetLocalAgentRef() != committed.GetLocalAgentRef() || replay.GetSourceContextStatus().GetSnapshotHash() != committed.GetSourceContextStatus().GetSnapshotHash() {
				t.Fatalf("commit replay = %+v, committed = %+v", replay, committed)
			}
			if committedCount, rolledBackCount := committer.counts(); committedCount != 1 || rolledBackCount != 0 {
				t.Fatalf("product callback counts committed=%d rolledBack=%d", committedCount, rolledBackCount)
			}
			challengeReplay, err := svc.CreateSourceMaterializationChallenge(ctx, sourceMaterializationTransportTestChallengeRequest("challenge-atomic-"+kind, challenge.GetSourceRef()))
			if err != nil {
				t.Fatalf("consumed challenge replay: %v", err)
			}
			if challengeReplay.GetState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED || challengeReplay.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_CHALLENGE_ALREADY_CONSUMED {
				t.Fatalf("consumed challenge replay = %+v", challengeReplay)
			}
			if err := svc.SetSourceMaterializationRuntimeIdentity(sourceMaterializationTransportTestRuntimeID + "-rotated"); err != nil {
				t.Fatalf("rotate Runtime identity: %v", err)
			}
			if _, found, err := svc.sourceMaterializationRepo.sourceSnapshot(context.Background(), committed.GetLocalAgentRef()); err != nil || !found {
				t.Fatalf("committed snapshot was lost on Runtime identity rotation: found=%v err=%v", found, err)
			}
			if _, err := svc.agentByID(committed.GetLocalAgentRef()); err != nil {
				t.Fatalf("committed agent was lost on Runtime identity rotation: %v", err)
			}
			assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())
		})
	}
}

func TestSourceMaterializationCommittedReplayRejectsSafeStatusDrift(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	product := materializeProductionSourceProduct(t, svc, "worldCharacter", "committed-status-drift")
	drifted := proto.Clone(product.commit.GetSourceContextStatus()).(*runtimev1.LocalAgentSourceContextStatus)
	drifted.SnapshotHash = strings.Repeat("0", 64)
	raw, err := (proto.MarshalOptions{Deterministic: true}).Marshal(drifted)
	if err != nil {
		t.Fatalf("marshal drifted source status: %v", err)
	}
	if _, err := svc.backend.DB().Exec(`UPDATE runtime_source_materialization_upload SET committed_source_context_status = ? WHERE upload_id = ?`, raw, product.begin.GetUploadId()); err != nil {
		t.Fatalf("seed drifted committed source status: %v", err)
	}
	_, err = svc.CommitSourceMaterialization(
		sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount),
		&runtimev1.CommitSourceMaterializationRequest{
			Context:            sourceMaterializationTransportTestRequestContext(product.challenge.GetSourceRef()),
			CommitRequestId:    "commit-committed-status-drift",
			UploadId:           product.begin.GetUploadId(),
			PacketHash:         product.begin.GetPacketHash(),
			BundleManifestHash: product.begin.GetBundleManifestHash(),
		},
	)
	if status.Code(err) != codes.DataLoss {
		t.Fatalf("drifted committed replay error = %v, want DataLoss", err)
	}
}

func TestSourceMaterializationProductTransactionFailureRollsBackMemoryAndDatabase(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	candidate := sourceMaterializationTransportTestCandidate(t, "realmPersona", "packet-product-rollback")
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{candidate: candidate})
	committer := &sourceMaterializationTransportTestCommitter{svc: svc, failTx: true}
	svc.SetSourceMaterializationProductCommitter(committer)
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, _, _, begin := sourceMaterializationTransportTestBeginPutCandidate(t, svc, ctx, candidate, "product-rollback")
	commit, err := svc.CommitSourceMaterialization(ctx, &runtimev1.CommitSourceMaterializationRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), CommitRequestId: "commit-product-rollback", UploadId: begin.GetUploadId(), PacketHash: begin.GetPacketHash(), BundleManifestHash: begin.GetBundleManifestHash()})
	if err != nil {
		t.Fatalf("product rollback commit: %v", err)
	}
	if commit.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_PERSISTENCE_FAILED || commit.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_FAILED {
		t.Fatalf("product rollback response = %+v", commit)
	}
	if committedCount, rolledBackCount := committer.counts(); committedCount != 0 || rolledBackCount != 1 {
		t.Fatalf("product rollback callback counts committed=%d rolledBack=%d", committedCount, rolledBackCount)
	}
	svc.mu.RLock()
	agentCount := len(svc.agents)
	svc.mu.RUnlock()
	if agentCount != 0 {
		t.Fatalf("in-memory agent count after rollback = %d", agentCount)
	}
	for _, table := range []string{"runtime_local_agent", "runtime_local_agent_source_snapshot", "runtime_local_agent_source_provenance"} {
		var count int
		if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s count after rollback = %d err=%v", table, count, err)
		}
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, begin.GetUploadId())
}

func TestSourceMaterializationConcurrentCommitAndAbortHaveOneWinner(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	candidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-race")
	blocking := &sourceMaterializationTransportBlockingAdmission{candidate: candidate, started: make(chan struct{}), release: make(chan struct{})}
	svc.SetSourceMaterializationAdmission(blocking)
	committer := &sourceMaterializationTransportTestCommitter{svc: svc}
	svc.SetSourceMaterializationProductCommitter(committer)
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, _, _, begin := sourceMaterializationTransportTestBeginPutCandidate(t, svc, ctx, candidate, "race")
	commitReq := &runtimev1.CommitSourceMaterializationRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), CommitRequestId: "commit-race", UploadId: begin.GetUploadId(), PacketHash: begin.GetPacketHash(), BundleManifestHash: begin.GetBundleManifestHash()}
	type commitResult struct {
		response *runtimev1.CommitSourceMaterializationResponse
		err      error
	}
	resultCh := make(chan commitResult, 1)
	go func() {
		response, err := svc.CommitSourceMaterialization(ctx, commitReq)
		resultCh <- commitResult{response: response, err: err}
	}()
	<-blocking.started
	inProgress, err := svc.CommitSourceMaterialization(ctx, commitReq)
	if err != nil {
		t.Fatalf("concurrent commit: %v", err)
	}
	if inProgress.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_IN_PROGRESS || inProgress.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTING {
		t.Fatalf("concurrent commit response = %+v", inProgress)
	}
	abort, err := svc.AbortSourceMaterializationUpload(ctx, &runtimev1.AbortSourceMaterializationUploadRequest{Context: sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()), AbortRequestId: "abort-race", UploadId: begin.GetUploadId(), PacketHash: begin.GetPacketHash(), BundleManifestHash: begin.GetBundleManifestHash()})
	if err != nil {
		t.Fatalf("abort during commit: %v", err)
	}
	if abort.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_COMMIT_IN_PROGRESS {
		t.Fatalf("abort during commit response = %+v", abort)
	}
	close(blocking.release)
	winner := <-resultCh
	if winner.err != nil || winner.response.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED {
		t.Fatalf("commit race winner response=%+v err=%v", winner.response, winner.err)
	}
	var agents, snapshots int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_local_agent`).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_local_agent_source_snapshot`).Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if agents != 1 || snapshots != 1 {
		t.Fatalf("race product counts agents=%d snapshots=%d", agents, snapshots)
	}
}
