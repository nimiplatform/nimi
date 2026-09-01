package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

const (
	Gemma4E2BTemplateIdentity   = "sha256:33204f1acb5bd0002713e16a593847f24ceeafe711ed88bda2a352dc996a3373"
	Gemma426BTemplateIdentity   = "sha256:94899c0f917d93f6fe81c95744d1e8ddab2d21d39228d2e4aec1fb2a25bff413"
	Gemma4E2BProjectorContentID = "sha256:140be8d7849741f88c50757d529b84373ee8e27052cc2236855b537f4a8215fa"
	Gemma426BProjectorContentID = "sha256:418a6d8723067cd712235facbbc5cba6c8fbbd413fc1292d2aace5a027d5a42f"
)

type Gemma4BehaviorCohortEntry struct {
	EntrySHA256        string
	ContentID          string
	TemplateIdentity   string
	ProjectorContentID string
}

var gemma4BehaviorCohort = [...]Gemma4BehaviorCohortEntry{
	gemma4CohortEntry("31aeee4a8b5c4a743f51f4021c29cfaa809d31a892cf9b918b9bb40542941197", Gemma4E2BTemplateIdentity, Gemma4E2BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("9378bc471710229ef165709b62e34bfb62231420ddaf6d729e727305b5b8672d", Gemma4E2BTemplateIdentity, Gemma4E2BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("d8fc2ac6fd597481dfd9c5ef9543ea1f0bda8088086da3853ce5e5564ab43bf8", Gemma4E2BTemplateIdentity, Gemma4E2BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("b36824f13bf9fab2910cb7b4282a4d73b13799ee4126d4ec241309ce69c0e783", Gemma4E2BTemplateIdentity, Gemma4E2BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("0a8488b149e1f700712c35d5bf0a3795f9dcc2563b4944d5ef2fb89375f9483e", Gemma4E2BTemplateIdentity, Gemma4E2BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("34c746b1d50ab813e29cd46c4796e3f43c741901a582f93a67b55b9fc9687b35", Gemma426BTemplateIdentity, Gemma426BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("f2fe28fc1d82e7c74f47d570a8c8847513fe2712a1b3a5bcd869031d952c4936", Gemma426BTemplateIdentity, Gemma426BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("d3d9e6a63845bdc83e9f9fc5923e77c023ccc1197c9e145e6a8754bad80b5d75", Gemma426BTemplateIdentity, Gemma426BProjectorContentID), // pragma: allowlist secret -- public model entry digest
	gemma4CohortEntry("b26c56ea4bf724b4efa0161bb4615e974847ec64450a4dd49da8712614a128c7", Gemma426BTemplateIdentity, Gemma426BProjectorContentID), // pragma: allowlist secret -- public model entry digest
}

func gemma4CohortEntry(entrySHA256, templateIdentity, projectorContentID string) Gemma4BehaviorCohortEntry {
	return Gemma4BehaviorCohortEntry{EntrySHA256: entrySHA256, ContentID: "sha256:" + entrySHA256, TemplateIdentity: templateIdentity, ProjectorContentID: projectorContentID}
}

func Gemma4BehaviorCohort() []Gemma4BehaviorCohortEntry {
	return append([]Gemma4BehaviorCohortEntry(nil), gemma4BehaviorCohort[:]...)
}

func gemma4CohortEntryForMain(contentID, entrySHA256, templateIdentity string) (Gemma4BehaviorCohortEntry, bool) {
	var match Gemma4BehaviorCohortEntry
	found := false
	for _, entry := range gemma4BehaviorCohort {
		if entry.ContentID != contentID || entry.EntrySHA256 != entrySHA256 || entry.TemplateIdentity != templateIdentity {
			continue
		}
		if found {
			return Gemma4BehaviorCohortEntry{}, false
		}
		match, found = entry, true
	}
	return match, found
}

func gemma4ProjectorForMainContent(contentID string) (string, bool) {
	for _, entry := range gemma4BehaviorCohort {
		if entry.ContentID == contentID {
			return entry.ProjectorContentID, true
		}
	}
	return "", false
}

func Gemma4ToolUseCapabilityProjection() *runtimev1.ToolUseCapabilityProjection {
	return &runtimev1.ToolUseCapabilityProjection{
		SupportedToolSpecKinds: []runtimev1.ToolSpecKind{runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION},
		SupportedToolChoiceModes: []runtimev1.ToolChoiceMode{
			runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO,
			runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE,
			runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
			runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL,
		},
		SupportsSingleCall: true, SupportsMultipleCalls: true, SupportsParallelCalls: true,
		SupportsSync: true, SupportsStream: true, SupportsToolOnlyResponse: true,
		SupportsToolResultRoundTrip: true, SupportsMixedTextAndToolCalls: true,
	}
}
