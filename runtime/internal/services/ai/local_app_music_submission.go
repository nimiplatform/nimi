package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-submission-identity
// Stored in the existing Job snapshot, atomically with its captured inputs.
// Every supported Job has the same action identity, independent from route.
// ReservedBytes is nonzero only for the separately admitted media retention
// policy; generic action identity does not grant that policy or a longer TTL.
type localAppMusicSubmission struct {
	ID            string `json:"id"`
	RequestSHA256 string `json:"request_sha256"`
	ReservedBytes int64  `json:"reserved_bytes"`
}

const maxVoiceConvertOutputBytes int64 = 64 << 20

// Includes bounded inline reference inputs and their captured transport encoding.
const voiceCreationRecoveryBytes int64 = 64 << 20

type localAppMusicSubmissionContextKey struct{}

var errLocalAppSubmissionConflict = errors.New("client submission id already belongs to another request")

func validClientSubmissionID(id string) bool {
	if len(id) < 1 || len(id) > 128 {
		return false
	}
	for _, ch := range id {
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			continue
		}
		return false
	}
	return true
}

func captureLocalAppMusicSubmission(req *runtimev1.SubmitLocalAppScenarioJobRequest) (*localAppMusicSubmission, error) {
	if req.GetClientSubmissionId() == "" {
		return nil, nil
	}
	if !validClientSubmissionID(req.GetClientSubmissionId()) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	// Includes every closed author input and the timeout; excludes no user field.
	// Deterministic protobuf encoding avoids map ordering changing the identity.
	canonical := req
	reservation := int64(0)
	if req.GetMusicGenerate() != nil {
		reservation = maxMusicRecoveryOutputBytes
	}
	if spec := req.GetMusicTranscribe(); spec != nil {
		if err := validateMusicTranscriptionSpec(spec); err != nil {
			return nil, err
		}
		canonical = proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
		canonical.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_MusicTranscribe{MusicTranscribe: canonicalMusicTranscriptionSpec(spec)}
		reservation = 64 << 20
	}
	if spec := req.GetAudioVoiceConvert(); spec != nil {
		if err := validateVoiceConvertSpec(spec); err != nil {
			return nil, err
		}
		canonical = proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
		canonical.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_AudioVoiceConvert{AudioVoiceConvert: canonicalVoiceConvertSpec(spec)}
		reservation = maxVoiceConvertOutputBytes
	}
	encoded, err := (proto.MarshalOptions{Deterministic: true}).Marshal(canonical)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return &localAppMusicSubmission{ID: req.GetClientSubmissionId(), RequestSHA256: hex.EncodeToString(digest[:]), ReservedBytes: reservation}, nil
}

func localAppMusicSubmissionFromContext(ctx context.Context) *localAppMusicSubmission {
	value, _ := ctx.Value(localAppMusicSubmissionContextKey{}).(*localAppMusicSubmission)
	return cloneLocalAppMusicSubmission(value)
}

func cloneLocalAppMusicSubmission(value *localAppMusicSubmission) *localAppMusicSubmission {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func voiceSubmissionRetention(value *localAppMusicSubmission, cloud *cloudResolvedAssembly) *localAppMusicSubmission {
	copy := cloneLocalAppMusicSubmission(value)
	if copy == nil {
		return nil
	}
	copy.ReservedBytes = 0
	if cloud != nil && cloud.VoiceWorkflow != nil && cloud.VoiceWorkflow.OutputPersistence == "provider_persistent" {
		copy.ReservedBytes = voiceCreationRecoveryBytes
	}
	return copy
}

func validateLocalAppMusicSubmission(value *localAppMusicSubmission, owner *localAppJobOwner, job *runtimev1.ScenarioJob, cloud *cloudResolvedAssembly) error {
	if value == nil {
		return nil
	}
	digest, err := hex.DecodeString(value.RequestSHA256)
	reservation := int64(0)
	switch job.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		reservation = maxMusicRecoveryOutputBytes
	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE:
		reservation = 64 << 20
	case runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT:
		reservation = maxVoiceConvertOutputBytes
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		if cloud != nil && cloud.VoiceWorkflow != nil && cloud.VoiceWorkflow.OutputPersistence == "provider_persistent" {
			reservation = voiceCreationRecoveryBytes
		}
	}
	if !owner.valid() || job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB || validateScenarioExecutionMode(job.GetScenarioType(), job.GetExecutionMode()) != nil || value.ReservedBytes != reservation || !validClientSubmissionID(value.ID) || err != nil || len(digest) != sha256.Size || strings.ToLower(value.RequestSHA256) != value.RequestSHA256 {
		return fmt.Errorf("invalid protected Job submission binding")
	}
	return nil
}

// Caller holds the store lock. Account and registered subject authorize;
// producer AppID is descriptive only and cannot partition or confer ownership.
func (s *scenarioJobStore) musicSubmissionLocked(owner *localAppJobOwner, id string) *scenarioJobRecord {
	if !owner.valid() {
		return nil
	}
	for _, record := range s.jobs {
		if record == nil || record.job == nil || record.musicSubmission == nil || !record.localAppOwner.valid() {
			continue
		}
		if record.localAppOwner.AccountID == owner.AccountID && record.localAppOwner.RegisteredAppSubject == owner.RegisteredAppSubject && record.musicSubmission.ID == id {
			return record
		}
	}
	return nil
}

func (s *scenarioJobStore) getMusicSubmission(owner *localAppJobOwner, id string, requestHash string) (*runtimev1.ScenarioJob, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record := s.musicSubmissionLocked(owner, id)
	if record == nil {
		if s.recoveryIncomplete {
			return nil, jobRecoveryAdmissionError()
		}
		return nil, nil
	}
	if scenarioJobPublicExpired(record, time.Now()) {
		return nil, errMusicRecoveryExpired
	}
	if requestHash != "" && record.musicSubmission.RequestSHA256 != requestHash {
		return nil, errLocalAppSubmissionConflict
	}
	return cloneScenarioJob(record.job), nil
}

func localAppSubmissionError(err error) error {
	if errors.Is(err, errLocalAppSubmissionConflict) {
		return grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT)
	}
	if errors.Is(err, errMusicRecoveryExpired) {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	if errors.Is(err, errMusicRecoveryCapacity) {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_MUSIC_RECOVERY_CAPACITY_EXCEEDED)
	}
	return err
}

func (s *Service) localAppScenarioJobSelector(ctx context.Context, req *runtimev1.GetLocalAppScenarioJobRequest) (string, error) {
	if req.GetClientSubmissionId() == "" {
		return validateLocalAppScenarioJobID(req.GetJobId())
	}
	if req.GetJobId() != "" || !validClientSubmissionID(req.GetClientSubmissionId()) {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	job, err := s.scenarioJobs.getMusicSubmission(localAppJobOwnerFromContext(ctx), req.GetClientSubmissionId(), "")
	if err != nil {
		return "", localAppSubmissionError(err)
	}
	if job == nil {
		return "", grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	return job.GetJobId(), nil
}
