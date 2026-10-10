package ai

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func localMusicTypedBodySlots(jobID string, effective *localMusicEffectiveInputs) []runtimeartifact.JobBodySlot {
	if effective.plan.IsVoiceConvert() {
		return []runtimeartifact.JobBodySlot{{ArtifactID: jobID + "-music-1", MaxBytes: audiomedia.MaxInputBytes}}
	}
	request := effective.transcriptionRequest
	var count int
	var bound int64
	for _, format := range request.GetRequestedFormats() {
		switch format {
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC:
			count += len(request.GetRequestedParts())
			bound = max(bound, musicscore.MaxBytes)
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI:
			count += len(request.GetRequestedParts())
			bound = max(bound, musicscore.MaxMIDIBytes)
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE:
			count++
			bound = max(bound, musicscore.MaxTimelineBytes)
		}
	}
	slots := make([]runtimeartifact.JobBodySlot, count)
	for i := range slots {
		slots[i] = runtimeartifact.JobBodySlot{ArtifactID: fmt.Sprintf("%s-music-%d", jobID, i+1), MaxBytes: bound}
	}
	return slots
}

// Typed references are remapped with the whole privately staged result, before
// a single primary Job commit makes any of the set readable.
func (s *Service) stageLocalMusicTypedResult(ctx context.Context, jobID string, effective *localMusicEffectiveInputs, artifacts []*runtimev1.ScenarioArtifact, bodies map[string]*capabilitydriver.ArtifactBody) ([]*runtimev1.ScenarioArtifact, map[string]string, error) {
	original := make([]string, len(artifacts))
	for i, a := range artifacts {
		original[i] = a.GetArtifactId()
	}
	staged, err := s.stageFiniteMediaBodies(ctx, jobID, effective.head, localMusicTypedBodySlots(jobID, effective), capabilitydriver.CloudMediaResult{Artifacts: artifacts, ArtifactBodies: bodies})
	if err != nil {
		return nil, nil, err
	}
	defer capabilitydriver.CloseArtifactBodies(staged.ArtifactBodies)
	bound, err := bindRuntimeJobArtifacts(jobID, effective.head, staged.Artifacts)
	if err != nil {
		return nil, nil, err
	}
	ids := map[string]string{}
	for i, a := range bound {
		ids[original[i]] = a.GetArtifactId()
	}
	return bound, ids, nil
}

func musicGenerationBodySlots(jobID string, score bool) []runtimeartifact.JobBodySlot {
	slots := []runtimeartifact.JobBodySlot{{ArtifactID: jobID + "-music-mix", MaxBytes: audiomedia.MaxInputBytes}}
	if score {
		slots = append(slots, runtimeartifact.JobBodySlot{ArtifactID: jobID + "-music-score", MaxBytes: musicscore.MaxBytes})
	}
	return slots
}
