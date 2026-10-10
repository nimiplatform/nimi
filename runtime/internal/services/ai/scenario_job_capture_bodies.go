package ai

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func scenarioCaptureJob(ctx context.Context) (*runtimev1.ScenarioJob, error) {
	job, _ := ctx.Value(scenarioCaptureRowKey{}).(*runtimev1.ScenarioJob)
	if job == nil {
		return nil, fmt.Errorf("Local file capture requires its original Job admission")
	}
	return job, nil
}
func canonicalArtifactFacts(record runtimeartifact.ArtifactRecord) audiomedia.Facts {
	facts := record.CanonicalAudio
	return audiomedia.Facts{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, SizeBytes: record.SizeBytes, DataOffset: facts.DataOffset}
}

// The captured source and output identities belong to the same Job. The
// original input is reopened under its owner and compared with the frozen
// facts before exact sample copying into its bounded private destination.
func (s *Service) copyScenarioCanonicalCapture(ctx context.Context, head *runtimev1.ScenarioRequestHead, sourceID string, original runtimeartifact.ArtifactRecord, start, end uint64, bodyID, path string) error {
	job, err := scenarioCaptureJob(ctx)
	if err != nil {
		return err
	}
	store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
	if !ok {
		return fmt.Errorf("capture body owner unavailable")
	}
	s.scenarioJobs.mu.RLock()
	capture := s.scenarioJobs.captureRows[job.JobId]
	var owner *runtimeartifact.ArtifactOwner
	if capture != nil {
		owner = s.runtimeArtifactOwnerForJobRecord(capture)
	}
	s.scenarioJobs.mu.RUnlock()
	if owner == nil {
		return fmt.Errorf("capture row promise unavailable")
	}
	err = store.WriteCanonicalJobBody(ctx, bodyID, runtimeartifact.ArtifactRecord{ProducerJobID: job.JobId, Owner: owner, MimeType: "audio/wav"}, func(writer runtimeartifact.CanonicalJobBodyWriter) (*runtimeartifact.CanonicalAudioInfo, error) {
		source, err := s.openMusicInputSource(ctx, head, sourceID)
		if err != nil {
			return nil, err
		}
		defer source.Body.Close()
		if original.CanonicalAudio == nil || source.Record.CanonicalAudio == nil || source.Record.ContentSHA256 != original.ContentSHA256 || source.Record.SizeBytes != original.SizeBytes || *source.Record.CanonicalAudio != *original.CanonicalAudio {
			return nil, fmt.Errorf("capture source changed after admission")
		}
		facts, err := audiomedia.CopyCanonicalRangeInto(ctx, source.Body, canonicalArtifactFacts(original), start, end, writer)
		if err != nil {
			return nil, err
		}
		return &runtimeartifact.CanonicalAudioInfo{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, DataOffset: facts.DataOffset}, nil
	})
	if err != nil {
		return err
	}
	return store.LinkJobBodyFile(ctx, job.JobId, bodyID, path)
}

type scenarioCanonicalCapture struct {
	sourceID   string
	original   runtimeartifact.ArtifactRecord
	start, end uint64
	path       string
}
