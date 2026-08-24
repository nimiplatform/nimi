package coregenerated

import (
	"encoding/json"
	"testing"
)

func TestRealmTypedModelsRejectMalformedSuccess(t *testing.T) {
	var user AuthUserDto
	if err := json.Unmarshal([]byte(`{}`), &user); err == nil {
		t.Fatal("missing required AuthUserDto fields were accepted")
	}

	var status AccountStatus
	if err := json.Unmarshal([]byte(`"FUTURE"`), &status); err == nil {
		t.Fatal("unknown AccountStatus was accepted")
	}
}

func TestRealmRequiredNullableScalarPreservesNullAndRejectsMissingOrWrongScalar(t *testing.T) {
	valid := []byte(`{"assetTier":1,"influenceTier":2,"interactionTier":3,"lastUpdatedAt":null,"userId":"user-nullable","vitalityScore":4}`)
	var tiers TierDetailDto
	if err := json.Unmarshal(valid, &tiers); err != nil {
		t.Fatalf("required nullable null was rejected: %v", err)
	}
	if tiers.LastUpdatedAt != nil {
		t.Fatalf("required nullable null collapsed to a value: %#v", tiers.LastUpdatedAt)
	}

	missing := []byte(`{"assetTier":1,"influenceTier":2,"interactionTier":3,"userId":"user-nullable","vitalityScore":4}`)
	if err := json.Unmarshal(missing, &tiers); err == nil {
		t.Fatal("missing required nullable field was accepted")
	}

	wrongScalar := []byte(`{"assetTier":"not-a-number","influenceTier":2,"interactionTier":3,"lastUpdatedAt":null,"userId":"user-nullable","vitalityScore":4}`)
	if err := json.Unmarshal(wrongScalar, &tiers); err == nil {
		t.Fatal("wrong Realm scalar was accepted")
	}
}
