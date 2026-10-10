package ai

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func localSpeechBodySlots(jobID string, effective *localSpeechEffectiveInputs) []runtimeartifact.JobBodySlot {
	count := 1
	bound := runtimeartifact.MaxCustodyBytes
	switch effective.scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SEPARATE:
		count = 2
		if effective.separatePlan != nil && effective.separatePlan.IncludeInstrumentParts() {
			count = 5
		}
		// Both admitted separation producers validate complete canonical stems
		// through InspectCanonical, whose whole-file limit is MaxInputBytes.
		bound = audiomedia.MaxInputBytes
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		bound = localexecution.MaxSpeechTranscriptBytes
	}
	slots := make([]runtimeartifact.JobBodySlot, count)
	for i := range slots {
		slots[i] = runtimeartifact.JobBodySlot{ArtifactID: fmt.Sprintf("%s-speech-%d", jobID, i+1), MaxBytes: bound}
	}
	return slots
}
