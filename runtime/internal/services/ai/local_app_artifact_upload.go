package ai

import (
	"context"
	"encoding/binary"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

// UploadLocalAppArtifact is the bounded unary counterpart to
// ReadLocalAppArtifact. Admission supplies the App+subject owner; the request
// can supply only bounded media bytes and a closed MIME value. Storage delegates to
// the same owner-custody sink as the chunked UploadArtifact owner RPC.
func (s *Service) UploadLocalAppArtifact(ctx context.Context, req *runtimev1.UploadLocalAppArtifactRequest) (*runtimev1.UploadLocalAppArtifactResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload)
	if err != nil {
		return nil, err
	}
	if req == nil || len(req.GetBytes()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	if len(req.GetBytes()) > runtimeartifact.MaxInlineBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	mimeType := strings.ToLower(strings.TrimSpace(req.GetMimeType()))
	switch mimeType {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4":
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED)
	}
	if mimeType == "video/mp4" && !isMP4Artifact(req.GetBytes()) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
	}
	stored, _, err := s.storeUploadedArtifact(ctx, decision.AppID, decision.AccountID, decision.RegisteredAppSubject, mimeType, req.GetBytes())
	if err != nil {
		return nil, err
	}
	return &runtimev1.UploadLocalAppArtifactResponse{
		ArtifactId: stored.GetArtifactId(),
		SizeBytes:  stored.GetSizeBytes(),
		MimeType:   stored.GetMimeType(),
	}, nil
}

// Container admission is independent of a model configuration. The selected
// video Driver subsequently validates codecs and decodes the entire timeline.
func isMP4Artifact(data []byte) bool {
	ftyp, moov, mdat := false, false, false
	for offset := 0; offset < len(data); {
		if len(data)-offset < 8 {
			return false
		}
		size, header := uint64(binary.BigEndian.Uint32(data[offset:])), 8
		kind := string(data[offset+4 : offset+8])
		if size == 1 {
			if len(data)-offset < 16 {
				return false
			}
			size, header = binary.BigEndian.Uint64(data[offset+8:]), 16
		} else if size == 0 {
			size = uint64(len(data) - offset)
		}
		if size < uint64(header) || size > uint64(len(data)-offset) {
			return false
		}
		switch kind {
		case "ftyp":
			if size < uint64(header+8) {
				return false
			}
			for index := offset + header; index+4 <= offset+int(size); index += 4 {
				switch string(data[index : index+4]) {
				case "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ":
					ftyp = true
				}
			}
		case "moov":
			moov = size > uint64(header)
		case "mdat":
			mdat = size > uint64(header)
		}
		offset += int(size)
	}
	return ftyp && moov && mdat
}
