package account

import "context"

// RealmCharacterPublicIntroduction carries selected public display facts only.
// Source identity remains in the account owner's request and validation path.
type RealmCharacterPublicIntroduction struct {
	WorldName              string
	Role                   *string
	ReferenceImageURL      *string
	VoiceSampleURL         *string
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
		result.ReferenceImageURL = source.Media.ReferenceImageURL
		result.VoiceSampleURL = source.Media.VoiceSampleURL
		if assets := source.Media.Assets; assets != nil {
			if result.ReferenceImageURL == nil {
				result.ReferenceImageURL = realmCharacterPublicAssetURL(assets.ReferenceImage)
			}
			if result.VoiceSampleURL == nil {
				result.VoiceSampleURL = realmCharacterPublicAssetURL(assets.VoiceSample)
			}
			if assets.VoiceSample != nil {
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
