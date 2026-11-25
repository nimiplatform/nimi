package localservice

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type selectedFileTestStream struct {
	grpc.ServerStream
	ctx    context.Context
	frames <-chan *runtimev1.ImportSelectedModelFileRequest
	result *runtimev1.ImportSelectedModelFileResponse
}

func (s *selectedFileTestStream) Context() context.Context { return s.ctx }
func (s *selectedFileTestStream) Recv() (*runtimev1.ImportSelectedModelFileRequest, error) {
	select {
	case frame, ok := <-s.frames:
		if !ok {
			return nil, io.EOF
		}
		return frame, nil
	case <-s.ctx.Done():
		return nil, s.ctx.Err()
	}
}
func (s *selectedFileTestStream) SendAndClose(r *runtimev1.ImportSelectedModelFileResponse) error {
	s.result = r
	return nil
}

func selectedHeader(name string, size int64) *runtimev1.ImportSelectedModelFileRequest {
	return &runtimev1.ImportSelectedModelFileRequest{Frame: &runtimev1.ImportSelectedModelFileRequest_Header_{Header: &runtimev1.ImportSelectedModelFileRequest_Header{FileName: name, SizeBytes: size}}}
}
func selectedData(b []byte) *runtimev1.ImportSelectedModelFileRequest {
	return &runtimev1.ImportSelectedModelFileRequest{Frame: &runtimev1.ImportSelectedModelFileRequest_Data{Data: b}}
}
func selectedSeal() *runtimev1.ImportSelectedModelFileRequest {
	return &runtimev1.ImportSelectedModelFileRequest{Frame: &runtimev1.ImportSelectedModelFileRequest_Seal{Seal: true}}
}

func receiveTestSelection(t *testing.T, s *Service, ctx context.Context, frames ...*runtimev1.ImportSelectedModelFileRequest) (*runtimev1.LocalTransferSessionSummary, error) {
	t.Helper()
	queue := make(chan *runtimev1.ImportSelectedModelFileRequest, len(frames))
	for _, f := range frames {
		queue <- f
	}
	close(queue)
	stream := &selectedFileTestStream{ctx: ctx, frames: queue}
	err := s.ImportSelectedModelFile(stream)
	return stream.result.GetTransfer(), err
}

func TestSelectedModelFilePublishesOnlySealedBytesAndReusesDistribution(t *testing.T) {
	s := newTestService(t)
	ctx := rpcctx.WithProtectedConnectionOwnerToken(context.Background(), rpcctx.ProtectedConnectionOwnerToken{1})
	b := validTestGGUF()
	header := selectedHeader("selected.gguf", int64(len(b)))
	data := selectedData(b)
	if _, err := receiveTestSelection(t, s, context.Background(), header, data, selectedSeal()); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("unprotected import: %v", err)
	}
	for _, frames := range [][]*runtimev1.ImportSelectedModelFileRequest{
		{selectedHeader("../unselected.gguf", 1)}, {header, data}, {header, selectedSeal()},
		{selectedHeader("large.gguf", selectedModelFileChunkLimit+1), selectedData(make([]byte, selectedModelFileChunkLimit+1))},
		{header, data, selectedSeal(), selectedData([]byte{1})},
	} {
		if _, err := receiveTestSelection(t, s, ctx, frames...); err == nil {
			t.Fatal("invalid import succeeded")
		}
	}
	if len(s.modelAssets) != 0 {
		t.Fatal("an unsealed or invalid source entered inventory")
	}
	for _, want := range []runtimev1.LocalTransferDisposition{runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED} {
		transfer, err := receiveTestSelection(t, s, ctx, header, selectedData(b[:4]), selectedData(b[4:]), selectedSeal())
		if err != nil || transfer.GetState() != localTransferStateCompleted || transfer.GetDisposition() != want || len(s.modelAssets) != 1 {
			t.Fatalf("sealed import: transfer=%v err=%v", transfer, err)
		}
		if _, err := os.Stat(managedModelImportStageDir(s.resolvedLocalModelsPath(), transfer.GetInstallSessionId())); !os.IsNotExist(err) {
			t.Fatalf("staging after commit: %v", err)
		}
	}
}

func TestSelectedModelFileCancellationWhileSenderIsIdle(t *testing.T) {
	s := newTestService(t)
	ctx, cancel := context.WithCancel(rpcctx.WithProtectedConnectionOwnerToken(context.Background(), rpcctx.ProtectedConnectionOwnerToken{2}))
	defer cancel()
	queue := make(chan *runtimev1.ImportSelectedModelFileRequest, 2)
	queue <- selectedHeader("cancel.gguf", 100)
	queue <- selectedData([]byte{1, 2, 3})
	stream := &selectedFileTestStream{ctx: ctx, frames: queue}
	done := make(chan error, 1)
	go func() { done <- s.ImportSelectedModelFile(stream) }()
	var id string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.RLock()
		for _, transfer := range s.transfers {
			if transfer.GetSourceLabel() == "cancel.gguf" && transfer.GetBytesReceived() > 0 {
				id = transfer.GetInstallSessionId()
			}
		}
		s.mu.RUnlock()
		if id != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("transfer never received its first frame")
	}
	if _, err := s.PauseLocalTransfer(ctx, &runtimev1.PauseLocalTransferRequest{InstallSessionId: id}); err != nil {
		t.Fatal(err)
	}
	if s.localTransferSummary(id).GetState() != localTransferStatePaused {
		t.Fatal("import did not pause")
	}
	if _, err := s.CancelLocalTransfer(ctx, &runtimev1.CancelLocalTransferRequest{InstallSessionId: id}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancel waited for another source frame")
	}
	if stream.result.GetTransfer().GetState() != localTransferStateCancelled || len(s.modelAssets) != 0 {
		t.Fatalf("cancel result %v", stream.result)
	}
	if _, err := os.Stat(filepath.Join(managedModelImportStageDir(s.resolvedLocalModelsPath(), id), "cancel.gguf")); !os.IsNotExist(err) {
		t.Fatalf("cancelled staging retained: %v", err)
	}
}

func TestSelectedModelFilePausedReceiverResumesAtSameOffset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "inflight")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := file.Close(); err != nil {
			t.Error(err)
		}
	}()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	queue := make(chan *runtimev1.ImportSelectedModelFileRequest)
	stream := &selectedFileTestStream{ctx: ctx, frames: queue}
	control := newLocalTransferControl()
	control.pause()
	done := make(chan error, 1)
	go func() { done <- receiveSelectedModelFrames(ctx, stream, control, file, 3, func(int64) {}) }()
	queue <- selectedData([]byte("abc"))
	// The source can offer one in-flight frame. A second frame must wait behind
	// it until Resume lets the receiver persist the first one.
	select {
	case queue <- selectedSeal():
		t.Fatal("paused transfer consumed queued bytes")
	case <-time.After(20 * time.Millisecond):
	}
	info, err := file.Stat()
	if err != nil || info.Size() != 0 {
		t.Fatalf("paused file: %v %v", info, err)
	}
	control.resume()
	queue <- selectedSeal()
	close(queue)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "abc" {
		t.Fatalf("resumed bytes %q, err %v", got, err)
	}
}
