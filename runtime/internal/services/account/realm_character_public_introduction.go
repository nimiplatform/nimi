package account

import (
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/realmmedia"
)

// RealmCharacterPublicIntroduction carries selected public display facts only.
// Source identity remains in the account owner's request and validation path.
type RealmCharacterPublicIntroduction struct {
	WorldName              string
	Role                   *string
	ReferenceImageURL      *string
	VoiceSampleURL         *string
	VoicePreviewURL        *string
	VoiceSampleContentHash *string
	VoiceSampleMimeType    *string
	VoiceSampleDurationSec *float64
	Works                  []string
	Relationships          []string
	Topics                 []string
}

func (s *Service) ResolveRealmCharacterPublicIntroduction(ctx context.Context, accountID string, sourceRef RealmSourceMaterializationSourceRefV3) (*RealmCharacterPublicIntroduction, error) {
	source, err := s.resolveRealmCharacterPublicSource(ctx, accountID, sourceRef)
	if err != nil {
		return nil, err
	}
	result := &RealmCharacterPublicIntroduction{WorldName: source.WorldName, Role: source.Role, Topics: source.Tags}
	if source.Media != nil {
		result.ReferenceImageURL = source.Media.External.ReferenceImageURL
		result.VoiceSampleURL = source.Media.External.VoiceSampleURL
		result.VoicePreviewURL = source.Media.External.VoiceSampleURL
		if assets := source.Media.Assets; assets != nil {
			if result.ReferenceImageURL == nil {
				result.ReferenceImageURL, err = realmCharacterPublicAssetURL(assets.ReferenceImage, "detail")
				if err != nil {
					return nil, err
				}
			}
			if result.VoiceSampleURL == nil {
				result.VoiceSampleURL, err = realmCharacterPublicAssetURL(assets.VoiceSample, "original")
				if err != nil {
					return nil, err
				}
			}
			if assets.VoiceSample != nil {
				result.VoicePreviewURL, err = realmCharacterPublicAssetURL(assets.VoiceSample, "audio-preview")
				if err != nil {
					return nil, err
				}
				delivery, decodeErr := realmmedia.Decode(assets.VoiceSample.Delivery)
				if decodeErr != nil {
					return nil, decodeErr
				}
				if result.VoiceSampleURL != nil {
					result.VoiceSampleMimeType = assets.VoiceSample.MimeType
				}
				if delivery != nil && result.VoiceSampleURL != nil {
					result.VoiceSampleContentHash = &delivery.ContentVersion
				}
				result.VoiceSampleDurationSec = assets.VoiceSample.DurationSec
			}
		}
	}
	if source.CharacterBiography != nil {
		for _, event := range source.CharacterBiography.LifeEvents {
			switch event.Kind {
			case "work":
				result.Works = append(result.Works, event.Title)
			case "relationship":
				result.Relationships = append(result.Relationships, event.Title)
			}
		}
	}
	return result, nil
}
