package runtimeagent

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"google.golang.org/protobuf/types/known/structpb"
)

const publicChatRealmProfilePromptHeader = "Realm Agent profile context:"

func publicChatAnchorSystemPromptFromMetadata(metadata *structpb.Struct) string {
	profile := conversationAnchorProfileContext(metadata)
	if profile == nil {
		return ""
	}

	lines := []string{
		publicChatRealmProfilePromptHeader,
		"Use this runtime-owned Realm profile context as source-backed context for the agent turn.",
		"Do not invent unsupported biography, timeline, relationships, titles, dates, events, voice, or portrait details.",
	}
	if source := profileString(profile, "sourceProfile", "source_profile"); source == "cbdb-historical" {
		lines = append(lines, "This is a CBDB historical profile; preserve sparse source-backed facts and say what is unknown instead of filling gaps.")
	}
	if scope := profileString(profile, "ownerScope", "owner_scope"); scope == "cbdb-curated-system" {
		lines = append(lines, "This is a curated system-agent profile; keep Halliday/system ownership distinct from the user's LocalAgent projection.")
	}

	addProfileLine := func(label string, keys ...string) {
		if value := profileString(profile, keys...); value != "" {
			lines = append(lines, "- "+label+": "+value)
		}
	}
	addProfileLine("displayName", "displayName", "display_name")
	addProfileLine("handle", "handle")
	addProfileLine("world", "worldName", "world_name")
	addProfileLine("worldId", "worldId", "world_id")
	addProfileLine("ownershipType", "ownershipType", "ownership_type")
	addProfileLine("avatarUrl", "avatarUrl", "avatar_url", "profileImageUrl", "profile_image_url")
	addProfileLine("defaultVoiceReference", "defaultVoiceReference", "default_voice_reference")
	addProfileLine("description", "description", "bio")
	addProfileLine("greeting", "greeting")
	addProfileLine("communicationStyle", "communicationStyle", "communication_style", "contentStyle", "content_style")
	if fields := profileStringList(profile, "selectedOwnerSettingFields", "selected_owner_setting_fields"); len(fields) > 0 {
		lines = append(lines, "- selectedOwnerSettingFields: "+strings.Join(fields, ", "))
	}
	if version := profileNumber(profile, "sourceCoreVersion", "source_core_version"); version != "" {
		lines = append(lines, "- sourceCoreVersion: "+version)
	}

	if len(lines) <= 3 {
		return ""
	}
	return strings.Join(lines, "\n")
}

func conversationAnchorProfileContext(metadata *structpb.Struct) map[string]*structpb.Value {
	if metadata == nil {
		return nil
	}
	for _, key := range []string{"realmProfileContext", "realm_profile_context"} {
		value := metadata.GetFields()[key]
		if value == nil || value.GetStructValue() == nil {
			continue
		}
		return value.GetStructValue().GetFields()
	}
	return nil
}

func profileString(fields map[string]*structpb.Value, keys ...string) string {
	for _, key := range keys {
		value := fields[key]
		if value == nil {
			continue
		}
		if text := compactAnchorProfilePromptText(value.GetStringValue(), 700); text != "" {
			return text
		}
	}
	return ""
}

func profileStringList(fields map[string]*structpb.Value, keys ...string) []string {
	for _, key := range keys {
		value := fields[key]
		if value == nil || value.GetListValue() == nil {
			continue
		}
		out := make([]string, 0, len(value.GetListValue().GetValues()))
		seen := map[string]bool{}
		for _, item := range value.GetListValue().GetValues() {
			text := compactAnchorProfilePromptText(item.GetStringValue(), 120)
			if text == "" || seen[text] {
				continue
			}
			seen[text] = true
			out = append(out, text)
		}
		return out
	}
	return nil
}

func profileBool(fields map[string]*structpb.Value, keys ...string) bool {
	for _, key := range keys {
		value := fields[key]
		if value == nil {
			continue
		}
		if value.GetBoolValue() {
			return true
		}
	}
	return false
}

func profileNumber(fields map[string]*structpb.Value, keys ...string) string {
	for _, key := range keys {
		value := fields[key]
		if value == nil {
			continue
		}
		if number := value.GetNumberValue(); number != 0 {
			return strconv.FormatFloat(number, 'f', -1, 64)
		}
		if text := compactAnchorProfilePromptText(value.GetStringValue(), 80); text != "" {
			return text
		}
	}
	return ""
}

func compactAnchorProfilePromptText(value string, maxRunes int) string {
	text := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if text == "" || maxRunes <= 0 || utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	runes := []rune(text)
	if maxRunes <= 3 {
		return string(runes[:maxRunes])
	}
	return string(runes[:maxRunes-3]) + "..."
}
