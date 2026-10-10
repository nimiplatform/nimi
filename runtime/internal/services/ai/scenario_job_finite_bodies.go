package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"io"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func requiredScenarioBodyCount(request *runtimev1.SubmitScenarioJobRequest) int {
	count := 1
	if spec := request.GetSpec().GetImageGenerate(); spec != nil && spec.GetN() > 0 {
		count = int(spec.GetN())
	}
	if spec := request.GetSpec().GetVideoGenerate(); spec != nil && spec.GetOptions().GetReturnLastFrame() {
		count++
	}
	if request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE {
		count = 2
	}
	return count
}

func (s *Service) prepareFiniteMediaBodies(ctx context.Context, jobID string, request *runtimev1.SubmitScenarioJobRequest) ([]runtimeartifact.JobBodySlot, error) {
	count := requiredScenarioBodyCount(request)
	bound := runtimeartifact.MaxCustodyBytes
	if request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		bound = audiomedia.MaxInputBytes
	}
	if request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE {
		bound = localexecution.MaxSpeechTranscriptBytes
	}
	slots := make([]runtimeartifact.JobBodySlot, count)
	for index := range slots {
		slots[index] = runtimeartifact.JobBodySlot{ArtifactID: fmt.Sprintf("%s-result-%d", jobID, index+1), MaxBytes: bound}
	}
	allSlots := slots
	if request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		allSlots = append(append([]runtimeartifact.JobBodySlot(nil), slots...), musicGenerationBodySlots(jobID, false)...)
	}
	if err := s.prepareScenarioBodySlots(ctx, jobID, allSlots); err != nil {
		return nil, err
	}
	return slots, nil
}

func (s *Service) stageFiniteMediaBodies(ctx context.Context, jobID string, head *runtimev1.ScenarioRequestHead, slots []runtimeartifact.JobBodySlot, result capabilitydriver.CloudMediaResult, canonical ...map[string]*runtimeartifact.CanonicalAudioInfo) (capabilitydriver.CloudMediaResult, error) {
	sourceBodies := result.ArtifactBodies
	defer capabilitydriver.CloseArtifactBodies(sourceBodies)
	if len(result.Artifacts) != len(slots) {
		return capabilitydriver.CloudMediaResult{}, fmt.Errorf("finite media result did not contain its complete required set")
	}
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return capabilitydriver.CloudMediaResult{}, fmt.Errorf("Job body custody owner unavailable")
	}
	owner := s.runtimeArtifactOwnerForJob(jobID, head)
	result.ArtifactBodies = map[string]*capabilitydriver.ArtifactBody{}
	for index, artifact := range result.Artifacts {
		body := sourceBodies[artifact.GetArtifactId()]
		if body != nil && body.Kind() == capabilitydriver.ArtifactBodyCommittedReference {
			result.ArtifactBodies[artifact.GetArtifactId()] = body
			continue
		}
		if body != nil {
			if metadata, complete := store.JobBodyStat(jobID, slots[index].ArtifactID); complete {
				if artifact.GetSizeBytes() <= 0 || metadata.SizeBytes != artifact.GetSizeBytes() || metadata.ContentSHA256 != scenarioArtifactDigest(artifact) || metadata.MimeType != artifact.GetMimeType() {
					return capabilitydriver.CloudMediaResult{}, fmt.Errorf("complete result disagrees with its retained body")
				}
				artifact.ArtifactId = slots[index].ArtifactID
				projectCommittedArtifactMetadata(artifact, metadata)
				continue
			}
		}
		if body == nil && len(artifact.GetBytes()) > 0 {
			if metadata, complete := store.JobBodyStat(jobID, slots[index].ArtifactID); complete {
				digest := sha256.Sum256(artifact.GetBytes())
				if metadata.SizeBytes != int64(len(artifact.GetBytes())) || metadata.ContentSHA256 != fmt.Sprintf("sha256:%x", digest) || metadata.MimeType != artifact.GetMimeType() {
					return capabilitydriver.CloudMediaResult{}, fmt.Errorf("codec result disagrees with its owned body")
				}
				artifact.ArtifactId = slots[index].ArtifactID
				projectCommittedArtifactMetadata(artifact, metadata)
				continue
			}
		}
		var source io.ReadCloser
		if body == nil && len(artifact.GetBytes()) > 0 {
			source = io.NopCloser(bytes.NewReader(artifact.GetBytes()))
		}
		if body != nil {
			switch body.Kind() {
			case capabilitydriver.ArtifactBodyBoundedBytes:
				source = io.NopCloser(bytes.NewReader(body.BoundedBytes()))
			case capabilitydriver.ArtifactBodyIncrementalStream:
				source = body.TakeIncrementalStream()
			}
		}
		if source == nil {
			return capabilitydriver.CloudMediaResult{}, fmt.Errorf("finite media result lacks an owned body")
		}
		var audio *runtimeartifact.CanonicalAudioInfo
		if len(canonical) > 0 {
			audio = canonical[0][artifact.GetArtifactId()]
		}
		artifact.ArtifactId = slots[index].ArtifactID
		var until time.Time
		release := func() {}
		var admissionErr error
		job, _ := s.scenarioJobs.get(jobID)
		if job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE || len(canonical) > 0 {
			until, release, admissionErr = s.scenarioJobs.musicArtifactAdmission(jobID, artifact.GetArtifactId(), artifact.GetSizeBytes())
		}
		if admissionErr != nil {
			source.Close()
			return capabilitydriver.CloudMediaResult{}, admissionErr
		}
		defer release()
		if err := store.StageJobBody(ctx, artifact.GetArtifactId(), runtimeartifact.ArtifactRecord{ProducerJobID: jobID, Owner: owner, MimeType: artifact.GetMimeType(), SizeBytes: artifact.GetSizeBytes(), ContentSHA256: scenarioArtifactDigest(artifact), CanonicalAudio: audio, MusicRecoveryUntil: until}, source); err != nil {
			return capabilitydriver.CloudMediaResult{}, err
		}
		metadata, ok := store.JobBodyStat(jobID, artifact.GetArtifactId())
		if !ok {
			return capabilitydriver.CloudMediaResult{}, fmt.Errorf("finite media body completion unavailable")
		}
		projectCommittedArtifactMetadata(artifact, metadata)
	}
	for _, artifact := range result.Artifacts {
		if result.ArtifactBodies[artifact.GetArtifactId()] != nil {
			continue
		}
		source, ok := store.OpenJobBody(ctx, jobID, artifact.GetArtifactId())
		if !ok {
			capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
			return capabilitydriver.CloudMediaResult{}, fmt.Errorf("finite media body integrity unavailable")
		}
		body, err := capabilitydriver.NewIncrementalArtifactBody(source.Body)
		if err != nil {
			source.Body.Close()
			capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
			return capabilitydriver.CloudMediaResult{}, err
		}
		result.ArtifactBodies[artifact.GetArtifactId()] = body
	}
	return result, nil
}
