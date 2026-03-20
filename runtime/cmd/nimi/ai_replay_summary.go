package main

import (
	"encoding/base64"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func summarizeExecuteScenarioResponse(fixture *aiGoldFixture, resp *runtimev1.ExecuteScenarioResponse) map[string]any {
	out := map[string]any{
		"finishReason": resp.GetFinishReason().String(),
		"inputTokens":  safeUsageInputTokens(resp.GetUsage()),
		"outputTokens": safeUsageOutputTokens(resp.GetUsage()),
		"computeMs":    safeUsageComputeMs(resp.GetUsage()),
	}
	switch strings.TrimSpace(strings.ToLower(fixture.Capability)) {
	case "text.generate":
		text := extractScenarioOutputText(resp.GetOutput())
		out["textLength"] = len(strings.TrimSpace(text))
		out["textPreview"] = trimPreview(text)
	case "text.embed":
		out["vectorCount"] = extractScenarioOutputVectorCount(resp.GetOutput())
	}
	return out
}

func summarizeScenarioArtifacts(artifacts []*runtimev1.ScenarioArtifact) map[string]any {
	mimeTypes := make([]string, 0, len(artifacts))
	totalBytes := 0
	artifactIDs := make([]string, 0, len(artifacts))
	textPreview := ""
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		if trimmed := strings.TrimSpace(artifact.GetMimeType()); trimmed != "" {
			mimeTypes = append(mimeTypes, trimmed)
		}
		artifactIDs = append(artifactIDs, strings.TrimSpace(artifact.GetArtifactId()))
		totalBytes += len(artifact.GetBytes())
		if textPreview == "" && strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "text/") {
			textPreview = trimPreview(string(artifact.GetBytes()))
		}
	}
	return map[string]any{
		"artifactCount": len(artifacts),
		"artifactIds":   artifactIDs,
		"mimeTypes":     mimeTypes,
		"totalBytes":    totalBytes,
		"textPreview":   textPreview,
		"base64Preview": firstArtifactBase64(artifacts),
	}
}

func extractScenarioOutputText(output *runtimev1.ScenarioOutput) string {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextGenerate); ok {
		return strings.TrimSpace(value.TextGenerate.GetText())
	}
	return ""
}

func extractScenarioOutputVectorCount(output *runtimev1.ScenarioOutput) int {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextEmbed); ok {
		return len(value.TextEmbed.GetVectors())
	}
	return 0
}

func firstArtifactBase64(artifacts []*runtimev1.ScenarioArtifact) string {
	for _, artifact := range artifacts {
		if artifact == nil || len(artifact.GetBytes()) == 0 {
			continue
		}
		encoded := base64.StdEncoding.EncodeToString(artifact.GetBytes())
		if len(encoded) > 64 {
			return encoded[:64]
		}
		return encoded
	}
	return ""
}

func safeUsageInputTokens(usage *runtimev1.UsageStats) int64 {
	if usage == nil {
		return 0
	}
	return usage.GetInputTokens()
}

func safeUsageOutputTokens(usage *runtimev1.UsageStats) int64 {
	if usage == nil {
		return 0
	}
	return usage.GetOutputTokens()
}

func safeUsageComputeMs(usage *runtimev1.UsageStats) int64 {
	if usage == nil {
		return 0
	}
	return usage.GetComputeMs()
}

func trimPreview(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) > 120 {
		return trimmed[:120]
	}
	return trimmed
}
