package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r075
func VideoContentWithPrompt(spec *runtimev1.VideoGenerateScenarioSpec) []*runtimev1.VideoContentItem {
	if spec == nil {
		return nil
	}
	content := spec.GetContent()
	prompt := strings.TrimSpace(spec.GetPrompt())
	if prompt == "" {
		return content
	}
	// SDK constructors may already mirror the top-level prompt as the first
	// text part. Retain later repetitions and the order of all supplied parts.
	for _, item := range content {
		if item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT &&
			item.GetRole() == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT {
			if strings.TrimSpace(item.GetText()) == prompt {
				return content
			}
			break
		}
	}
	merged := make([]*runtimev1.VideoContentItem, 0, len(content)+1)
	merged = append(merged, &runtimev1.VideoContentItem{
		Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
		Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
		Text: prompt,
	})
	return append(merged, content...)
}

func VideoPrompt(spec *runtimev1.VideoGenerateScenarioSpec) string {
	if spec == nil {
		return ""
	}
	parts := make([]string, 0, len(spec.GetContent()))
	for _, item := range VideoContentWithPrompt(spec) {
		if item == nil || item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		if role := item.GetRole(); role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_UNSPECIFIED && role != runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT {
			continue
		}
		if text := strings.TrimSpace(item.GetText()); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n")
}
