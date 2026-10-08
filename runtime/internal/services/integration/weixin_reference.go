package integration

import (
	"bytes"
	"encoding/json"
	"unicode/utf8"
)

type nativePartialText struct {
	Start      string `json:"start"`
	End        string `json:"end"`
	StartIndex int64  `json:"startIndex"`
	EndIndex   int64  `json:"endIndex"`
	QuoteMD5   string `json:"quoteMD5"`
}
type nativeReference struct {
	MessageID     string                 `json:"messageId"`
	Relation      string                 `json:"relation,omitempty"`
	Title         string                 `json:"title"`
	Text          string                 `json:"text"`
	Origin        string                 `json:"origin,omitempty"`
	MediaKind     string                 `json:"mediaKind"`
	FileName      string                 `json:"fileName"`
	ContentStatus string                 `json:"contentStatus"`
	PartialText   *nativePartialText     `json:"partialText,omitempty"`
	Media         []nativeReferenceMedia `json:"media,omitempty"`
}

// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
type nativeReferenceMedia struct {
	Kind              string        `json:"kind"`
	MediaRef          string        `json:"mediaRef"`
	FileName          string        `json:"fileName"`
	MediaType         string        `json:"mediaType"`
	SizeBytes         int64         `json:"sizeBytes"`
	UnavailableReason string        `json:"unavailableReason,omitempty"`
	Source            *nativeSource `json:"-"`
}

// @nimi-authority: definition.nimi.runtime.integration.native-operation-contract
// A quote projects one supplied item only. It never follows a nested ref_msg,
// creates a media/reply capability or fetches a historic message by its ID.
func weixinReference(raw json.RawMessage) (*nativeReference, error) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	if len(raw) > nativeEventLimit {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	var quote struct {
		MessageID string      `json:"svr_id"`
		Title     string      `json:"title"`
		Item      *weixinItem `json:"message_item"`
		Partial   *struct {
			Start      string `json:"start"`
			End        string `json:"end"`
			StartIndex *int64 `json:"startindex"`
			EndIndex   *int64 `json:"endindex"`
			QuoteMD5   string `json:"quotemd5"`
		} `json:"partial_text"`
	}
	if json.Unmarshal(raw, &quote) != nil {
		return nil, adapterError("INTEGRATION_WEIXIN_REFERENCE_INVALID")
	}
	ref := &nativeReference{MessageID: quote.MessageID, Title: quote.Title, ContentStatus: "not-provided"}
	if item := quote.Item; item != nil {
		if ref.MessageID == "" {
			ref.MessageID = item.MessageID
		}
		switch item.Type {
		case 0:
			// Official NONE, also the default when the optional type is absent.
			ref.ContentStatus = "not-provided"
		case 1:
			ref.Text = item.Text.Text
			ref.ContentStatus = "text-provided"
		case 2:
			ref.MediaKind = "image"
			ref.ContentStatus = "media-metadata-only"
		case 3:
			ref.MediaKind = "audio"
			ref.ContentStatus = "media-metadata-only"
			if item.Voice.Text != "" {
				ref.Text = item.Voice.Text
				ref.Origin = "platform-transcription"
				ref.ContentStatus = "text-provided"
			}
		case 4:
			ref.MediaKind = "file"
			ref.FileName = item.File.Name
			ref.ContentStatus = "media-metadata-only"
		case 5:
			ref.MediaKind = "video"
			ref.ContentStatus = "media-metadata-only"
		default:
			ref.ContentStatus = "unsupported"
		}
	}
	if ref.MessageID != "" && !validExternalIdentifier(ref.MessageID) || utf8.RuneCountInString(ref.Title) > 1024 || utf8.RuneCountInString(ref.Text) > 32768 || utf8.RuneCountInString(ref.FileName) > 255 {
		return nil, adapterError("INTEGRATION_EVENT_BOUNDS")
	}
	if partial := quote.Partial; partial != nil {
		if partial.StartIndex == nil || partial.EndIndex == nil || utf8.RuneCountInString(partial.Start) > 32768 || utf8.RuneCountInString(partial.End) > 32768 || *partial.StartIndex < 0 || *partial.EndIndex < *partial.StartIndex || *partial.StartIndex > 9007199254740991 || *partial.EndIndex > 9007199254740991 || len(partial.QuoteMD5) > 128 {
			return nil, adapterError("INTEGRATION_WEIXIN_REFERENCE_INVALID")
		}
		ref.PartialText = &nativePartialText{Start: partial.Start, End: partial.End, StartIndex: *partial.StartIndex, EndIndex: *partial.EndIndex, QuoteMD5: partial.QuoteMD5}
	}
	return ref, nil
}
