package ai

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func outputText(output *runtimev1.ScenarioOutput) string {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextGenerate); ok {
		return value.TextGenerate.GetText()
	}
	return ""
}

func outputVectorCount(output *runtimev1.ScenarioOutput) int {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextEmbed); ok {
		return len(value.TextEmbed.GetVectors())
	}
	return 0
}

func deltaArtifactChunk(delta *runtimev1.ScenarioStreamDelta) []byte {
	if value, ok := delta.GetDelta().(*runtimev1.ScenarioStreamDelta_Artifact); ok {
		return value.Artifact.GetChunk()
	}
	return nil
}

func deltaArtifactMimeType(delta *runtimev1.ScenarioStreamDelta) string {
	if value, ok := delta.GetDelta().(*runtimev1.ScenarioStreamDelta_Artifact); ok {
		return value.Artifact.GetMimeType()
	}
	return ""
}
