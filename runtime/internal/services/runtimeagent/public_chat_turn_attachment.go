package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// resolvePublicChatTurnAttachments revalidates every caller-referenced
// attachment against the Runtime artifact store at turn admission
// (rule.nimi.runtime.agent-participation.r171/r172): the artifact must exist,
// the caller identity (subject_user_id + app) must equal the upload-time
// owner, and the store record mime must stay inside the admitted image
// whitelist. The artifact id alone never authorizes reference.
func (s *Service) resolvePublicChatTurnAttachments(
	subjectUserID string,
	callerAppID string,
	messages []publicChatMessagePayload,
) ([]publicChatResolvedAttachment, error) {
	var referenced []publicChatAttachmentPayload
	for _, message := range messages {
		referenced = append(referenced, message.Attachments...)
	}
	if len(referenced) == 0 {
		return nil, nil
	}
	if s == nil || s.runtimeArtifacts == nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime artifact store is unavailable")
	}
	subjectUserID = strings.TrimSpace(subjectUserID)
	callerAppID = strings.TrimSpace(callerAppID)
	resolved := make([]publicChatResolvedAttachment, 0, len(referenced))
	for _, attachment := range referenced {
		artifactID := strings.TrimSpace(attachment.ArtifactID)
		record, ok := s.runtimeArtifacts.Get(artifactID)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
		}
		if record.Owner == nil || record.Owner.SubjectUserID != subjectUserID || record.Owner.AppID != callerAppID ||
			subjectUserID == "" || callerAppID == "" {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
		switch strings.ToLower(strings.TrimSpace(record.MimeType)) {
		case "image/png", "image/jpeg", "image/webp", "image/gif":
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED)
		}
		resolved = append(resolved, publicChatResolvedAttachment{
			ArtifactID:  artifactID,
			MimeType:    strings.ToLower(strings.TrimSpace(record.MimeType)),
			DisplayName: strings.TrimSpace(attachment.DisplayName),
		})
	}
	return resolved, nil
}
