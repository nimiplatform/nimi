package localservice

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const selectedModelFileChunkLimit = 1 << 20

// @nimi-authority: rule.nimi.runtime.local-compute.desktop-selected-file-import
func (s *Service) ImportSelectedModelFile(stream grpc.ClientStreamingServer[runtimev1.ImportSelectedModelFileRequest, runtimev1.ImportSelectedModelFileResponse]) error {
	if _, ok := rpcctx.ProtectedConnectionOwnerTokenFromContext(stream.Context()); !ok {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	if err := s.requireModelAssetWrites(); err != nil {
		return err
	}
	first, err := stream.Recv()
	if err != nil {
		return err
	}
	header := first.GetHeader()
	name := header.GetFileName()
	if header == nil || header.GetSizeBytes() < 0 || !safeModelAssetRelativePath(name) ||
		strings.ContainsAny(name, "/\\") || name != strings.TrimSpace(name) || isModelAssetControlFile(name) {
		return invalidSelectedModelFile(errors.New("expected a single regular model filename and its length"))
	}
	s.mu.Lock()
	if s.jobLifetimeCancel == nil {
		s.mu.Unlock()
		return status.Error(codes.Unavailable, "Runtime is stopping")
	}
	s.transferWorkerWG.Add(1)
	s.mu.Unlock()
	defer s.transferWorkerWG.Done()
	root, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return err
	}
	if err := s.ensureModelObjectLinkSupport(root); err != nil {
		return modelObjectLinkSupportRPCError(err)
	}
	transfer, err := s.createLocalTransfer(localTransferKindImport, localTransferMutation{
		Phase: "copy", State: localTransferStateRunning, Message: "receiving selected model file",
		BytesTotal: header.GetSizeBytes(), SourceLabel: name,
	}, nil, &localTransferImportSpec{DisplayName: name, SizeBytes: header.GetSizeBytes()}, true)
	if err != nil {
		return localTransferPersistenceError(err)
	}
	id := transfer.GetInstallSessionId()
	control := s.transferControl(id)
	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()
	stop := context.AfterFunc(s.jobLifetimeCtx, cancel)
	defer stop()
	// The stream is the single writer. Its lifetime owns staging and cancellation
	// just as the path-based import executor owns its transfer.
	_, runErr := s.receiveSelectedModelFile(ctx, stream, control, root, id, name, header.GetSizeBytes())
	if runErr != nil {
		s.settleFailedAcquisition(id, runErr, false)
	}
	s.finishManagedModelDownloadExecutor(id, control, runErr)
	if runErr != nil {
		if errors.Is(runErr, errLocalTransferCancelled) {
			return stream.SendAndClose(&runtimev1.ImportSelectedModelFileResponse{Transfer: s.localTransferSummary(id)})
		}
		if errors.Is(runErr, context.Canceled) {
			return context.Canceled
		}
		if errors.Is(runErr, syscall.ENOSPC) {
			return status.Error(codes.ResourceExhausted, "model storage is full")
		}
		var conflict *modelObjectConflict
		if errors.As(runErr, &conflict) {
			return modelObjectConflictRPCError(conflict)
		}
		return invalidSelectedModelFile(runErr)
	}
	return stream.SendAndClose(&runtimev1.ImportSelectedModelFileResponse{Transfer: s.localTransferSummary(id)})
}

func invalidSelectedModelFile(err error) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err,
		grpcerr.ReasonOptions{Message: "selected model file import failed", ActionHint: "reselect_model_file"})
}

func (s *Service) receiveSelectedModelFile(ctx context.Context, stream grpc.ClientStreamingServer[runtimev1.ImportSelectedModelFileRequest, runtimev1.ImportSelectedModelFileResponse], control *localTransferControl, root, id, name string, size int64) (*runtimev1.ModelAssetRecord, error) {
	stage := managedModelImportStageDir(root, id)
	if err := os.MkdirAll(stage, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(stage, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	receiveErr := receiveSelectedModelFrames(ctx, stream, control, file, size, func(received int64) {
		s.updateTransferReuse(id, "copy", received, 0, "receiving selected model file")
	})
	if err := file.Close(); receiveErr == nil {
		receiveErr = err
	}
	if receiveErr != nil {
		// In particular, release an incomplete file before persisting an ENOSPC
		// outcome to the same volume. The ordinary transfer owner retries cleanup.
		if err := os.RemoveAll(stage); err != nil {
			s.logger.Warn("selected file staging cleanup pending", "transfer_id", id, "error", err)
		}
		return nil, receiveErr
	}
	source, err := inspectModelAssetSource(path, name)
	if err != nil {
		return nil, err
	}
	source.transferOwned = true
	record, err := s.importModelAssetContent(ctx, id, root, source)
	if err == nil {
		// Equivalent-distribution reuse can finish without entering publication.
		if cleanupErr := os.RemoveAll(stage); cleanupErr != nil {
			s.setTransferCleanupPending(id, true)
		}
	}
	return record, err
}

type selectedModelFrame struct {
	message *runtimev1.ImportSelectedModelFileRequest
	err     error
}

func receiveSelectedModelFrames(ctx context.Context, stream grpc.ClientStreamingServer[runtimev1.ImportSelectedModelFileRequest, runtimev1.ImportSelectedModelFileResponse], control *localTransferControl, file *os.File, size int64, progress func(int64)) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	frames := make(chan selectedModelFrame)
	go func() {
		for {
			message, err := stream.Recv()
			select {
			case frames <- selectedModelFrame{message, err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	var received int64
	sealed := false
	for {
		control.mu.Lock()
		paused, cancelled, changed := control.paused, control.cancelled, control.signal
		control.mu.Unlock()
		if cancelled {
			return errLocalTransferCancelled
		}
		var ready <-chan selectedModelFrame
		if !paused {
			ready = frames
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
			continue
		case frame := <-ready:
			if errors.Is(frame.err, io.EOF) && sealed {
				return file.Sync()
			}
			if frame.err != nil {
				return fmt.Errorf("selected file stream ended before publication: %w", frame.err)
			}
			if sealed {
				return errors.New("unexpected frame after the selected file seal")
			}
			switch part := frame.message.GetFrame().(type) {
			case *runtimev1.ImportSelectedModelFileRequest_Data:
				n := int64(len(part.Data))
				if n == 0 || n > selectedModelFileChunkLimit || n > size-received {
					return errors.New("invalid selected file frame length")
				}
				if _, err := file.Write(part.Data); err != nil {
					return err
				}
				received += n
				progress(received)
			case *runtimev1.ImportSelectedModelFileRequest_Seal:
				if !part.Seal || received != size {
					return errors.New("selected file does not match its declared length")
				}
				sealed = true
			default:
				return errors.New("expected selected file bytes or seal")
			}
		}
	}
}
