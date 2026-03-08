package main

import (
	"encoding/base64"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
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
		text := extractStructStringField(resp.GetOutput(), "text")
		out["textLength"] = len(strings.TrimSpace(text))
		out["textPreview"] = trimPreview(text)
	case "text.embed":
		out["vectorCount"] = extractStructListCount(resp.GetOutput(), "vectors")
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

func extractStructStringField(output *structpb.Struct, key string) string {
	if output == nil {
		return ""
	}
	field, ok := output.GetFields()[key]
	if !ok || field == nil {
		return ""
	}
	return strings.TrimSpace(field.GetStringValue())
}

func extractStructListCount(output *structpb.Struct, key string) int {
	if output == nil {
		return 0
	}
	field, ok := output.GetFields()[key]
	if !ok || field == nil || field.GetListValue() == nil {
		return 0
	}
	return len(field.GetListValue().GetValues())
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
