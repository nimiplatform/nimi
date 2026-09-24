package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func sha256HexForTest(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func newAdmissionHoldTestService(t *testing.T) *Service {
	t.Helper()
	svc := &Service{entryHashCache: make(map[string]entryHashCacheState), admissionHolds: make(map[string]*admissionPayloadHold)}
	t.Cleanup(svc.releaseAdmissionHolds)
	return svc
}

// admitForTest runs one admission's locked verification of a payload.
func admitForTest(t *testing.T, svc *Service, path string) string {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	sum, err := svc.admitPayloadLocked(context.Background(), admissionPass{}, path, info, "generation")
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

func retainedHoldsForTest(svc *Service) int {
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	return len(svc.admissionHolds)
}

// A writer that stays open can rewrite a payload without advancing any file
// system change marker (audit 12), so no admission reuses a digest across it.
func TestAdmissionPayloadSeesRewritesThroughAWriterThatStaysOpen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.bin")
	first := bytes.Repeat([]byte("A"), 4096)
	second := bytes.Repeat([]byte("B"), len(first))
	third := bytes.Repeat([]byte("C"), len(first))
	if err := os.WriteFile(path, first, 0o600); err != nil {
		t.Fatal(err)
	}
	held := holdsAdmissionPayloadsForTest(t, path)
	t.Logf("payload hold available on this volume: %v", held)
	writer, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = writer.Close() }()
	if _, err := writer.WriteAt(first, 0); err != nil {
		t.Fatal(err)
	}
	if err := writer.Sync(); err != nil {
		t.Fatal(err)
	}
	svc := newAdmissionHoldTestService(t)
	if got := admitForTest(t, svc, path); got != sha256HexForTest(first) {
		t.Fatalf("first admission digest = %s", got)
	}
	if retainedHoldsForTest(svc) != 0 {
		t.Fatal("admission held a payload that a writer keeps open")
	}
	if _, err := writer.WriteAt(second, 0); err != nil {
		t.Fatal(err)
	}
	if err := writer.Sync(); err != nil {
		t.Fatal(err)
	}
	if actual, err := os.ReadFile(path); err != nil || !bytes.Equal(actual, second) {
		t.Fatalf("the rewrite is not visible: %v", err)
	}
	if got, want := admitForTest(t, svc, path), sha256HexForTest(second); got != want {
		t.Fatalf("admission after a rewrite through the open writer = %s, want %s", got, want)
	}

	// Without a writer the payload is held: writes are refused and the digest
	// is reused until a ModelAsset change releases the hold.
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if got := admitForTest(t, svc, path); got != sha256HexForTest(second) {
		t.Fatalf("admission after the writer closed = %s", got)
	}
	if held {
		if retainedHoldsForTest(svc) != 1 {
			t.Fatal("admission retained no hold on a payload without writers")
		}
		if err := os.WriteFile(path, third, 0o600); err == nil {
			t.Fatal("a held payload accepted a write")
		}
		if got := admitForTest(t, svc, path); got != sha256HexForTest(second) {
			t.Fatalf("held admission digest = %s", got)
		}
		svc.lockModelAssetMutation()
		svc.modelAssetMutationMu.Unlock()
		if retainedHoldsForTest(svc) != 0 {
			t.Fatal("a ModelAsset change kept admission holds")
		}
	} else if retainedHoldsForTest(svc) != 0 {
		t.Fatal("a platform without payload holds retained one")
	}
	if err := os.WriteFile(path, third, 0o600); err != nil {
		t.Fatal(err)
	}
	if got, want := admitForTest(t, svc, path), sha256HexForTest(third); got != want {
		t.Fatalf("admission after the released payload changed = %s, want %s", got, want)
	}
}

// A digest borrowed before the locks stays valid only while the very hold it
// came from does (audit 13): after a release the bytes can change in place
// with the same file identity and verification generation.
func TestAdmissionPayloadBorrowedDigestNeedsTheSameHoldUnderTheLocks(t *testing.T) {
	first := bytes.Repeat([]byte("A"), 4096)
	second := bytes.Repeat([]byte("B"), len(first))
	for _, test := range []struct {
		name            string
		release, rehold bool
		want            []byte
		wantHashes      int
	}{
		{name: "hold kept", want: first},
		{name: "hold released", release: true, want: second, wantHashes: 1},
		{name: "path held again after the release", release: true, rehold: true, want: second},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "payload.bin")
			if err := os.WriteFile(path, first, 0o600); err != nil {
				t.Fatal(err)
			}
			if !holdsAdmissionPayloadsForTest(t, path) {
				t.Skip("this platform or volume gives admission no payload hold")
			}
			svc := newAdmissionHoldTestService(t)
			ctx := context.Background()
			if admitForTest(t, svc, path) != sha256HexForTest(first) || retainedHoldsForTest(svc) != 1 {
				t.Fatal("the first admission retained no hold")
			}
			info, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			// The next admission borrows that digest before taking the locks.
			earlier, err := svc.verifyAdmissionPayload(ctx, path, info, "generation")
			if err != nil || earlier.borrowed == nil {
				t.Fatalf("pre-lock verification did not borrow the retained hold: %+v err=%v", earlier, err)
			}
			pass := admissionPass{admissionPayloadKey(path): earlier}
			defer pass.close()
			if test.release {
				// Another ModelAsset change releases every hold; then the bytes
				// change in place under the same identity and generation.
				svc.lockModelAssetMutation()
				svc.modelAssetMutationMu.Unlock()
				if err := os.WriteFile(path, second, 0o600); err != nil {
					t.Fatal(err)
				}
				if identity, _, err := modelFileIdentityOf(path); err != nil || identity != earlier.identity {
					t.Fatalf("the rewrite changed the file identity: %v", err)
				}
			}
			if test.rehold && admitForTest(t, svc, path) != sha256HexForTest(second) {
				t.Fatal("the admission that holds the new bytes hashed something else")
			}
			hashed := 0
			svc.mu.Lock()
			svc.entryFileSHA256 = func(path string) (string, error) {
				hashed++
				return computeFileSHA256(path)
			}
			svc.mu.Unlock()
			info, err = os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			svc.modelAssetMutationMu.Lock()
			got, err := svc.admitPayloadLocked(ctx, pass, path, info, "generation")
			svc.modelAssetMutationMu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			if want := sha256HexForTest(test.want); got != want {
				t.Fatalf("locked capture digest = %s, want %s", got, want)
			}
			if hashed != test.wantHashes {
				t.Fatalf("locked capture hashed %d times, want %d", hashed, test.wantHashes)
			}
			if retainedHoldsForTest(svc) != 1 {
				t.Fatalf("retained holds = %d, want one on the current bytes", retainedHoldsForTest(svc))
			}
		})
	}
}

// The same interleaving through the production pre-lock verification and the
// locked capture: payload drift behind a released borrowed hold is rejected,
// not admitted under the old digest.
func TestCaptureRejectsDriftBehindABorrowedHoldReleasedBeforeTheLocks(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	prepared := prepareEmbeddingLoadoutForTest(t, svc, context.Background(), "", "Embedding borrowed hold", asset)
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	svc.mu.RLock()
	entryPath := filepath.Join(svc.modelAssetDirectories[asset.GetModelAssetId()], filepath.FromSlash(asset.GetEntry()))
	svc.mu.RUnlock()
	if !holdsAdmissionPayloadsForTest(t, entryPath) {
		t.Skip("this platform or volume gives admission no payload hold")
	}
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract
	selected, err := svc.CaptureLocalExecution(ctx, contract, committed.GetLoadoutId())
	if err != nil {
		t.Fatal(err)
	}
	selected.ModelAssetUse.Release()

	pass, err := svc.preverifyLocalExecutionPayloads(ctx, contract, committed.GetLoadoutId())
	if err != nil {
		t.Fatal(err)
	}
	defer pass.close()
	if earlier := pass[admissionPayloadKey(entryPath)]; earlier.borrowed == nil {
		t.Fatalf("pre-lock verification did not borrow the retained hold: %+v", earlier)
	}
	svc.lockModelAssetMutation()
	svc.modelAssetMutationMu.Unlock()
	info, err := os.Stat(entryPath)
	if err != nil {
		t.Fatal(err)
	}
	drifted, err := os.ReadFile(entryPath)
	if err != nil {
		t.Fatal(err)
	}
	drifted[len(drifted)-1] ^= 0x01
	if err := os.WriteFile(entryPath, drifted, info.Mode().Perm()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(entryPath, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}

	svc.loadoutMutationMu.Lock()
	svc.modelAssetMutationMu.Lock()
	captured, err := svc.resolveLocalExecutionLocked(ctx, pass, contract, committed.GetLoadoutId())
	svc.modelAssetMutationMu.Unlock()
	svc.loadoutMutationMu.Unlock()
	if captured != nil || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
		t.Fatalf("capture after the borrowed hold ended = %+v reason:%s err:%v", captured, grpcReasonForTest(err), err)
	}
}

func TestCaptureLocalExecutionKeepsOnlyTheHoldsOfACompletedCapture(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	prepared := prepareEmbeddingLoadoutForTest(t, svc, context.Background(), "", "Embedding holds", asset)
	committed := commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false)
	svc.mu.RLock()
	entryPath := filepath.Join(svc.modelAssetDirectories[asset.GetModelAssetId()], filepath.FromSlash(asset.GetEntry()))
	svc.mu.RUnlock()
	held := holdsAdmissionPayloadsForTest(t, entryPath)
	writable := func() error {
		writer, err := os.OpenFile(entryPath, os.O_RDWR, 0)
		if err == nil {
			_ = writer.Close()
		}
		return err
	}

	// A capture that gives up waiting behind a ModelAsset change keeps nothing open.
	svc.modelAssetMutationMu.Lock()
	deadline, stop := context.WithTimeout(context.Background(), 100*time.Millisecond)
	selected, err := svc.CaptureLocalExecution(deadline, capabilitydriver.TextEmbedCapabilityContract, committed.GetLoadoutId())
	stop()
	svc.modelAssetMutationMu.Unlock()
	if selected != nil || status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("capture past its deadline = %+v err=%v", selected, err)
	}
	if retainedHoldsForTest(svc) != 0 {
		t.Fatal("an abandoned capture retained holds")
	}
	if err := writable(); err != nil {
		t.Fatalf("an abandoned capture left the payload held: %v", err)
	}

	svc.OpenModelAssetReclamation()
	selected, err = svc.CaptureLocalExecution(context.Background(), capabilitydriver.TextEmbedCapabilityContract, committed.GetLoadoutId())
	if err != nil || selected == nil {
		t.Fatalf("capture = %+v err=%v", selected, err)
	}
	selected.ModelAssetUse.Release()
	if !held {
		if retainedHoldsForTest(svc) != 0 {
			t.Fatal("a platform without payload holds retained one")
		}
		return
	}
	if retainedHoldsForTest(svc) != len(asset.GetFiles()) {
		t.Fatalf("completed capture retained %d holds, want %d", retainedHoldsForTest(svc), len(asset.GetFiles()))
	}
	if err := writable(); err == nil {
		t.Fatal("a retained hold let a writer open the payload")
	}
	// Every execution Host that goes idle retries cleanup; with nothing to
	// clean up, that changes no file and keeps the holds.
	svc.retryModelAssetCleanupObligations()
	if retainedHoldsForTest(svc) != len(asset.GetFiles()) {
		t.Fatal("an idle cleanup retry without cleanup work released admission holds")
	}
	// Runtime's own inventory changes release every hold first.
	if err := svc.reclaimUnreferencedModelObjects(); err != nil {
		t.Fatal(err)
	}
	if retainedHoldsForTest(svc) != 0 {
		t.Fatal("object reclamation ran with admission holds open")
	}
	if err := writable(); err != nil {
		t.Fatalf("payload stayed held after a ModelAsset change: %v", err)
	}
}

func TestComputeFileSHA256ContextStopsWithItsCaller(t *testing.T) {
	path := filepath.Join(t.TempDir(), "payload.bin")
	if err := os.WriteFile(path, make([]byte, 1<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := computeFileSHA256Context(ctx, path); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled hash err = %v", err)
	}
}
