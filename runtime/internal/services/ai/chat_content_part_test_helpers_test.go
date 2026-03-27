package ai

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func textPart(text string) *runtimev1.ChatContentPart {
	return &runtimev1.ChatContentPart{
		Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
		Content: &runtimev1.ChatContentPart_Text{
			Text: text,
		},
	}
}

func imagePart(url string) *runtimev1.ChatContentPart {
	return &runtimev1.ChatContentPart{
		Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
		Content: &runtimev1.ChatContentPart_ImageUrl{
			ImageUrl: &runtimev1.ChatContentImageURL{Url: url},
		},
	}
}

func imagePartWithDetail(url string, detail string) *runtimev1.ChatContentPart {
	return &runtimev1.ChatContentPart{
		Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL,
		Content: &runtimev1.ChatContentPart_ImageUrl{
			ImageUrl: &runtimev1.ChatContentImageURL{Url: url, Detail: detail},
		},
	}
}

func videoPart(url string) *runtimev1.ChatContentPart {
	return &runtimev1.ChatContentPart{
		Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL,
		Content: &runtimev1.ChatContentPart_VideoUrl{
			VideoUrl: url,
		},
	}
}

func audioPart(url string) *runtimev1.ChatContentPart {
	return &runtimev1.ChatContentPart{
		Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL,
		Content: &runtimev1.ChatContentPart_AudioUrl{
			AudioUrl: url,
		},
	}
}

func artifactRefPart(ref *runtimev1.ChatContentArtifactRef) *runtimev1.ChatContentPart {
	return &runtimev1.ChatContentPart{
		Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF,
		Content: &runtimev1.ChatContentPart_ArtifactRef{
			ArtifactRef: ref,
		},
	}
}
