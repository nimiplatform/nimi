package app

import (
	"context"
	"errors"
	"io"
	"math"
	"path"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const localAppAssetMaxSafeInteger = int64(1<<53 - 1)

var (
	errLocalAppAssetFrameInvalid = errors.New("local App asset stream frame is invalid")
	errLocalAppAssetRangeInvalid = errors.New("local App asset range is invalid")
)

func (s *Service) StatLocalAppAsset(ctx context.Context, req *runtimev1.StatLocalAppAssetRequest) (*runtimev1.StatLocalAppAssetResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageAssetStat)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppAssetFailure(appstorage.ErrAssetPathInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	record, err := store.Stat(ctx, localAppAssetOwner(decision), req.GetRelativePath())
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	return &runtimev1.StatLocalAppAssetResponse{Asset: projectLocalAppAsset(record), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) ListLocalAppAssets(ctx context.Context, req *runtimev1.ListLocalAppAssetsRequest) (*runtimev1.ListLocalAppAssetsResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageAssetList)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppAssetFailure(appstorage.ErrAssetPathInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	page, err := store.List(ctx, localAppAssetOwner(decision), req.GetPrefix(), req.GetCursor(), int(req.GetPageSize()))
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	assets := make([]*runtimev1.LocalAppAssetRecord, 0, len(page.Assets))
	for _, record := range page.Assets {
		assets = append(assets, projectLocalAppAsset(record))
	}
	return &runtimev1.ListLocalAppAssetsResponse{Assets: assets, NextCursor: page.NextCursor, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) WriteLocalAppAsset(stream runtimev1.RuntimeAppService_WriteLocalAppAssetServer) error {
	if stream == nil {
		return localAppAssetFailure(errLocalAppAssetFrameInvalid)
	}
	decision, err := s.localAppStorageDecision(stream.Context(), accountservice.LocalAppOperationStorageAssetWrite)
	if err != nil {
		return err
	}
	first, err := stream.Recv()
	if err != nil {
		return localAppAssetFailure(errLocalAppAssetFrameInvalid)
	}
	metadata := first.GetMetadata()
	if metadata == nil {
		return localAppAssetFailure(errLocalAppAssetFrameInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return localAppAssetFailure(err)
	}
	source := &localAppAssetWriteSource{stream: stream}
	record, err := store.Write(
		stream.Context(), localAppAssetOwner(decision), metadata.GetRelativePath(), metadata.GetMediaType(), metadata.GetOverwrite(), source,
	)
	if err != nil {
		return localAppAssetFailure(err)
	}
	return stream.SendAndClose(&runtimev1.WriteLocalAppAssetResponse{Asset: projectLocalAppAsset(record), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED})
}

func (s *Service) ReadLocalAppAsset(req *runtimev1.ReadLocalAppAssetRequest, stream runtimev1.RuntimeAppService_ReadLocalAppAssetServer) error {
	if stream == nil {
		return localAppAssetFailure(appstorage.ErrAssetUnavailable)
	}
	decision, err := s.localAppStorageDecision(stream.Context(), accountservice.LocalAppOperationStorageAssetRead)
	if err != nil {
		return err
	}
	if req == nil {
		return localAppAssetFailure(appstorage.ErrAssetPathInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return localAppAssetFailure(err)
	}
	source, err := store.Open(stream.Context(), localAppAssetOwner(decision), req.GetRelativePath())
	if err != nil {
		return localAppAssetFailure(err)
	}
	defer func() { _ = source.Body.Close() }()
	offset, length, err := resolveLocalAppAssetRange(req, source.Record.SizeBytes)
	if err != nil {
		return localAppAssetFailure(err)
	}
	if _, err := source.Body.Seek(offset, io.SeekStart); err != nil {
		return localAppAssetFailure(appstorage.ErrAssetCorrupt)
	}
	if err := stream.Send(&runtimev1.ReadLocalAppAssetResponse{
		Frame: &runtimev1.ReadLocalAppAssetResponse_Metadata{
			Metadata: &runtimev1.ReadLocalAppAssetMetadata{
				Asset: projectLocalAppAsset(source.Record),
				Range: &runtimev1.LocalAppAssetRange{Offset: offset, Length: length, TotalSize: source.Record.SizeBytes},
			},
		},
	}); err != nil {
		return err
	}
	buffer := make([]byte, appstorage.AssetChunkBytes)
	remaining := length
	for remaining > 0 {
		readSize := int64(len(buffer))
		if remaining < readSize {
			readSize = remaining
		}
		read, readErr := source.Body.Read(buffer[:readSize])
		if read > 0 {
			if err := stream.Send(&runtimev1.ReadLocalAppAssetResponse{Frame: &runtimev1.ReadLocalAppAssetResponse_BodyChunk{BodyChunk: append([]byte(nil), buffer[:read]...)}}); err != nil {
				return err
			}
			remaining -= int64(read)
		}
		if readErr != nil {
			if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
				return readErr
			}
			if readErr == io.EOF && remaining == 0 {
				break
			}
			return localAppAssetFailure(appstorage.ErrAssetCorrupt)
		}
		if read == 0 {
			return localAppAssetFailure(appstorage.ErrAssetCorrupt)
		}
	}
	return nil
}

func (s *Service) RemoveLocalAppAsset(ctx context.Context, req *runtimev1.RemoveLocalAppAssetRequest) (*runtimev1.RemoveLocalAppAssetResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageAssetRemove)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppAssetFailure(appstorage.ErrAssetPathInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	removed, err := store.Remove(ctx, localAppAssetOwner(decision), req.GetRelativePath())
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	return &runtimev1.RemoveLocalAppAssetResponse{Removed: removed, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) MoveLocalAppAsset(ctx context.Context, req *runtimev1.MoveLocalAppAssetRequest) (*runtimev1.MoveLocalAppAssetResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageAssetMove)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppAssetFailure(appstorage.ErrAssetPathInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	record, err := store.Move(ctx, localAppAssetOwner(decision), req.GetFromRelativePath(), req.GetToRelativePath(), req.GetOverwrite())
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	return &runtimev1.MoveLocalAppAssetResponse{Asset: projectLocalAppAsset(record), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-proto-046
func (s *Service) RevealLocalAppAsset(ctx context.Context, req *runtimev1.RevealLocalAppAssetRequest) (*runtimev1.RevealLocalAppAssetResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageAssetReveal)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppAssetFailure(appstorage.ErrAssetPathInvalid)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	record, absolutePath, err := store.ResolveRevealTarget(ctx, localAppAssetOwner(decision), req.GetRelativePath())
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	return &runtimev1.RevealLocalAppAssetResponse{
		Asset: projectLocalAppAsset(record), AbsolutePath: absolutePath, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) AdoptLocalAppArtifact(ctx context.Context, req *runtimev1.AdoptLocalAppArtifactRequest) (*runtimev1.AdoptLocalAppArtifactResponse, error) {
	decision, err := s.localAppArtifactAdoptionDecision(ctx)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppArtifactUnavailable()
	}
	if _, err := appstorage.NormalizeAssetRelativePath(req.GetRelativePath()); err != nil {
		return nil, localAppAssetFailure(err)
	}
	store, err := s.localAppAssets()
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	if err := ctx.Err(); err != nil {
		return nil, localAppAssetFailure(err)
	}
	source, err := runtimeartifact.OpenAuthorizedLocalAppArtifact(ctx, s.localDevelopmentArtifacts, req.GetArtifactId(), runtimeartifact.LocalAppArtifactOwner{
		AccountID: decision.AccountID, RegisteredAppSubject: decision.RegisteredAppSubject,
	}, runtimeartifact.LocalAppArtifactUseAdoption)
	if err != nil {
		return nil, localAppArtifactUnavailable()
	}
	targetPath, err := adoptedAssetTargetPath(req.GetRelativePath(), source.Record.MimeType)
	if err != nil {
		_ = source.Body.Close()
		return nil, localAppAssetFailure(err)
	}
	record, err := store.Adopt(ctx, localAppAssetOwner(decision), targetPath, req.GetOverwrite(), appstorage.VerifiedAssetInput{
		MediaType: source.Record.MimeType,
		SizeBytes: source.Record.SizeBytes,
		SHA256:    source.Record.ContentSHA256,
		Body:      source.Body,
	})
	if errors.Is(err, appstorage.ErrAssetCorrupt) {
		return nil, localAppArtifactUnavailable()
	}
	if err != nil {
		return nil, localAppAssetFailure(err)
	}
	return &runtimev1.AdoptLocalAppArtifactResponse{Asset: projectLocalAppAsset(record), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func adoptedAssetTargetPath(relativePath string, mediaType string) (string, error) {
	normalized, err := appstorage.NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return "", err
	}
	extension := adoptedAssetExtension(mediaType)
	base := strings.TrimSuffix(normalized, path.Ext(normalized))
	return appstorage.NormalizeAssetRelativePath(base + extension)
}

func adoptedAssetExtension(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "audio/wav", "audio/x-wav":
		return ".wav"
	case "audio/mpeg":
		return ".mp3"
	case "audio/ogg":
		return ".ogg"
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "application/json":
		return ".json"
	case "text/plain":
		return ".txt"
	default:
		return ".bin"
	}
}

func (s *Service) localAppArtifactAdoptionDecision(ctx context.Context) (accountservice.LocalAppCallerDecision, error) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != accountservice.LocalAppOperationArtifactAdoptToStorage ||
		decision.AuthorityClass != localappop.AuthorityClassAppAccess || decision.OperationCapability != "runtime.consume" ||
		strings.TrimSpace(decision.AccountID) == "" || decision.AccountID != strings.TrimSpace(decision.AccountID) ||
		strings.TrimSpace(decision.RegisteredAppSubject) == "" || decision.RegisteredAppSubject != strings.TrimSpace(decision.RegisteredAppSubject) ||
		decision.ExpiresAt.IsZero() || !s.now().UTC().Before(decision.ExpiresAt.UTC()) {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	return decision, nil
}

func localAppArtifactUnavailable() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_ARTIFACT_UNAVAILABLE, grpcerr.ReasonOptions{
		Message: "local App artifact is unavailable for adoption",
	})
}

type localAppAssetWriteSource struct {
	stream  runtimev1.RuntimeAppService_WriteLocalAppAssetServer
	pending []byte
	closed  bool
}

func (source *localAppAssetWriteSource) Read(target []byte) (int, error) {
	for len(source.pending) == 0 {
		if source.closed {
			return 0, io.EOF
		}
		frame, err := source.stream.Recv()
		if err == io.EOF {
			source.closed = true
			return 0, io.EOF
		}
		if err != nil {
			return 0, err
		}
		body, ok := frame.GetFrame().(*runtimev1.WriteLocalAppAssetRequest_BodyChunk)
		if !ok || len(body.BodyChunk) > appstorage.AssetChunkBytes {
			return 0, errLocalAppAssetFrameInvalid
		}
		if len(body.BodyChunk) == 0 {
			continue
		}
		source.pending = body.BodyChunk
	}
	read := copy(target, source.pending)
	source.pending = source.pending[read:]
	return read, nil
}

func (source *localAppAssetWriteSource) Close() error {
	source.closed = true
	source.pending = nil
	return nil
}

func (s *Service) localAppAssets() (*appstorage.AssetStore, error) {
	if s == nil || strings.TrimSpace(s.appStorageDataRoot) == "" {
		return nil, appstorage.ErrAssetUnavailable
	}
	s.localAppAssetStoreOnce.Do(func() {
		s.localAppAssetStore, s.localAppAssetStoreErr = appstorage.NewAssetStore(s.appStorageDataRoot, s.localAppAssetPolicy)
	})
	return s.localAppAssetStore, s.localAppAssetStoreErr
}

func localAppAssetOwner(decision accountservice.LocalAppCallerDecision) appstorage.ManagedOwner {
	return appstorage.ManagedOwner{AccountID: decision.AccountID, RegisteredAppSubject: decision.RegisteredAppSubject}
}

func projectLocalAppAsset(record appstorage.AssetRecord) *runtimev1.LocalAppAssetRecord {
	return &runtimev1.LocalAppAssetRecord{
		RelativePath: record.RelativePath,
		MediaType:    record.MediaType,
		SizeBytes:    record.SizeBytes,
		Sha256:       record.SHA256,
		CreatedAt:    timestamppb.New(record.CreatedAt),
		UpdatedAt:    timestamppb.New(record.ModifiedAt),
	}
}

func resolveLocalAppAssetRange(req *runtimev1.ReadLocalAppAssetRequest, totalSize int64) (int64, int64, error) {
	if totalSize < 0 || totalSize > localAppAssetMaxSafeInteger {
		return 0, 0, errLocalAppAssetRangeInvalid
	}
	offset := int64(0)
	if req.Offset != nil {
		offset = req.GetOffset()
		if offset < 0 || offset > localAppAssetMaxSafeInteger {
			return 0, 0, errLocalAppAssetRangeInvalid
		}
	}
	if offset > totalSize {
		return 0, 0, errLocalAppAssetRangeInvalid
	}
	length := totalSize - offset
	if req.Length != nil {
		requested := req.GetLength()
		if requested <= 0 || requested > localAppAssetMaxSafeInteger || requested > math.MaxInt64-offset {
			return 0, 0, errLocalAppAssetRangeInvalid
		}
		if requested < length {
			length = requested
		}
	}
	return offset, length, nil
}

func localAppAssetFailure(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return status.FromContextError(err).Err()
	}
	if code := status.Code(err); code == codes.Canceled || code == codes.DeadlineExceeded {
		return err
	}
	options := grpcerr.ReasonOptions{Message: "local App asset storage operation failed"}
	switch {
	case errors.Is(err, appstorage.ErrAssetPathInvalid):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID, err, options)
	case errors.Is(err, appstorage.ErrAssetNotFound):
		return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_STORAGE_ENTRY_NOT_FOUND, err, options)
	case errors.Is(err, appstorage.ErrAssetAlreadyExists):
		return grpcerr.WrapWithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_APP_STORAGE_ENTRY_ALREADY_EXISTS, err, options)
	case errors.Is(err, appstorage.ErrAssetQuota):
		return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_STORAGE_QUOTA_EXCEEDED, err, options)
	case errors.Is(err, appstorage.ErrAssetTooLarge):
		return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_STORAGE_OBJECT_TOO_LARGE, err, options)
	case errors.Is(err, errLocalAppAssetRangeInvalid):
		return grpcerr.WrapWithReasonCode(codes.OutOfRange, runtimev1.ReasonCode_APP_STORAGE_RANGE_INVALID, err, options)
	case errors.Is(err, appstorage.ErrAssetCursorInvalid):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_STORAGE_CURSOR_INVALID, err, options)
	case errors.Is(err, appstorage.ErrAssetMediaInvalid):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err, options)
	case errors.Is(err, appstorage.ErrAssetCorrupt):
		return grpcerr.WrapWithReasonCode(codes.DataLoss, runtimev1.ReasonCode_APP_STORAGE_INTEGRITY_FAILURE, err, options)
	case errors.Is(err, errLocalAppAssetFrameInvalid):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err, options)
	default:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE, err, options)
	}
}
