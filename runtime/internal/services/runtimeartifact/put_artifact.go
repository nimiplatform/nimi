package runtimeartifact

import (
	"bytes"
	"context"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// MaxPutArtifactBytes is the admitted per-file bound for user attachment
// uploads (4 MiB raw bytes; rule.nimi.runtime.agent-participation.r170).
const MaxPutArtifactBytes = 4 * 1024 * 1024

// PutArtifact uploads bounded user attachment material into the runtime
// artifact store so that a conversation turn can later reference it by
// artifact_id. Admission order is fail closed:
//  1. caller identity (protected principal or authorized local app)
//  2. raw byte length bound (before any derived allocation)
//  3. declared image mime whitelist
//  4. payload signature vs declared mime (corrupt payloads count as mismatch)
//
// The stored record carries Runtime-owned owner metadata (subject_user_id +
// calling app identity); the artifact_id is never an authorization credential.
func (s *Service) PutArtifact(
	ctx context.Context,
	req *runtimev1.PutArtifactRequest,
) (*runtimev1.PutArtifactResponse, error) {
	if s == nil || s.store == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
	}
	owner, err := s.putArtifactCallerOwner(ctx)
	if err != nil {
		return nil, err
	}
	data := req.GetData()
	if len(data) > MaxPutArtifactBytes {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	mimeType := strings.ToLower(strings.TrimSpace(req.GetMimeType()))
	switch mimeType {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED)
	}
	if !putArtifactSignatureMatches(mimeType, data) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_UPLOAD_CONTENT_MISMATCH)
	}
	artifactID := "artifact_" + ulid.Make().String()
	if err := s.store.Put(artifactID, ArtifactRecord{
		Bytes:    data,
		MimeType: mimeType,
		Owner:    owner,
	}); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
			err,
			grpcerr.ReasonOptions{Message: "uploaded attachment artifact could not be stored"},
		)
	}
	return &runtimev1.PutArtifactResponse{ArtifactId: artifactID}, nil
}

// putArtifactCallerOwner resolves the Runtime-authorized caller identity that
// becomes the artifact owner. Local-app callers authorize through the closed
// conversation-turn operation (uploading an attachment is part of the
// conversation send plane); protected principals use their attached identity.
func (s *Service) putArtifactCallerOwner(ctx context.Context) (*ArtifactOwner, error) {
	principal, protectedCaller := protectedprincipal.AttachedToContext(ctx)
	if protectedCaller {
		if !principal.Valid() {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
		return &ArtifactOwner{
			SubjectUserID: strings.TrimSpace(principal.AccountID),
			AppID:         strings.TrimSpace(principal.AppID),
		}, nil
	}
	if s.authorizer == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	decision, err := s.authorizer.AuthorizeLocalAppOperation(ctx, accountservice.LocalAppOperationSendConversationTurn)
	if err != nil || !validLocalAppArtifactPutDecision(decision, s.now().UTC()) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	return &ArtifactOwner{
		SubjectUserID: strings.TrimSpace(decision.AccountID),
		AppID:         strings.TrimSpace(decision.AppID),
	}, nil
}

// validLocalAppArtifactPutDecision mirrors validLocalAppArtifactDecision for
// the write side: the exact closed operation is the conversation-turn send
// operation, whose Runtime-owned capability is "agents.interact".
func validLocalAppArtifactPutDecision(decision accountservice.LocalAppCallerDecision, now time.Time) bool {
	commonValid := decision.SessionID != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.AppID) != "" &&
		decision.HostExecutableDigest != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.AccountID) != "" &&
		strings.TrimSpace(decision.RealmEnvironmentID) != "" && decision.AccountGeneration > 0 &&
		decision.Operation == accountservice.LocalAppOperationSendConversationTurn && decision.OperationCapability == "agents.interact" &&
		decision.TrustClass == accountservice.LocalAppTrustClassDevelopment &&
		decision.RegistrationHandle != (protectedlocal.Identifier{}) && strings.TrimSpace(decision.RegisteredAppSubject) != "" &&
		decision.SourceGeneration > 0 && decision.DeclarationGeneration > 0
	if !commonValid {
		return false
	}
	direct := decision.DirectPeer.OS == protectedlocal.OSMacOS && decision.DirectPeer.PID != 0 && decision.DirectPeer.UID != 0 &&
		decision.RuntimeBootEpoch == (protectedlocal.Identifier{}) && decision.Process == (protectedlocal.ProcessTuple{}) &&
		decision.ExpiresAt.IsZero() &&
		protectedlocal.IsAbsolutePathForOperatingSystem(decision.DirectPeer.OS, decision.ProjectRoot)
	sessionScoped := decision.DirectPeer == (protectedlocal.DirectLocalAppPeer{}) &&
		decision.RuntimeBootEpoch != (protectedlocal.Identifier{}) && decision.Process.PID > 0 &&
		strings.TrimSpace(decision.Process.CreationMarker) != "" &&
		decision.Process.ExecutableDigest == decision.HostExecutableDigest &&
		now.Before(decision.ExpiresAt.UTC()) &&
		protectedlocal.IsAbsolutePathForOperatingSystem(decision.Process.OS, decision.ProjectRoot) &&
		protectedlocal.IsLocalDevelopmentProcessTrustSet(decision.Process) &&
		protectedlocal.IsAbsolutePathForOperatingSystem(decision.Process.OS, decision.Process.CanonicalExecutablePath)
	return direct || sessionScoped
}

// putArtifactSignatureMatches verifies the payload file signature against the
// declared image mime. Corrupt or structurally unparsable payloads count as
// mismatch. PNG/JPEG/GIF additionally validate the decoded image header via
// the standard library; WebP is validated on its RIFF/WEBP signature because
// the standard library does not decode WebP.
func putArtifactSignatureMatches(declaredMime string, data []byte) bool {
	switch declaredMime {
	case "image/png":
		return bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) && decodesImageHeaderAs(data, "png")
	case "image/jpeg":
		return bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}) && decodesImageHeaderAs(data, "jpeg")
	case "image/gif":
		return (bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))) && decodesImageHeaderAs(data, "gif")
	case "image/webp":
		return len(data) >= 12 && bytes.Equal(data[0:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP"))
	default:
		return false
	}
}

func decodesImageHeaderAs(data []byte, expectedFormat string) bool {
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	return err == nil && format == expectedFormat
}
