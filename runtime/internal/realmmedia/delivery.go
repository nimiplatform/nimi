package realmmedia

import (
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"regexp"
)

var identity = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var version = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Decode carries Realm-owned delivery facts; it neither grants access nor assembles a URL.
func Decode(raw json.RawMessage) (*runtimev1.RealmMediaDelivery, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	result := &runtimev1.RealmMediaDelivery{}
	if err := protojson.Unmarshal(raw, result); err != nil {
		return nil, fmt.Errorf("invalid Realm media delivery")
	}
	if !identity.MatchString(result.ResourceId) || !version.MatchString(result.ContentVersion) || result.PublicationGeneration < 1 || result.PolicyVersion != "v1" {
		return nil, fmt.Errorf("invalid Realm media identity")
	}
	return result, nil
}

// Image selects an existing bounded WebP family for single-image Runtime presentation contracts.
func Image(delivery *runtimev1.RealmMediaDelivery, purpose string, width int32) *string {
	if delivery == nil {
		return nil
	}
	for _, set := range delivery.Images {
		if set.Purpose != purpose {
			continue
		}
		for _, family := range set.Families {
			if family.MimeType != "image/webp" {
				continue
			}
			var selected *runtimev1.RealmMediaImageSource
			for _, source := range family.Sources {
				if source.Width < 1 || source.Height < 1 || source.Url == "" {
					continue
				}
				if selected == nil || (selected.Width < width && source.Width > selected.Width) || (source.Width >= width && source.Width < selected.Width) {
					selected = source
				}
			}
			if selected != nil {
				return &selected.Url
			}
		}
	}
	return nil
}
