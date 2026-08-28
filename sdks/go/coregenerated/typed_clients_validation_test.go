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

func TestTerminateCurrentAccountResponseEnforcesOpenAPILiterals(t *testing.T) {
	valid := []byte(`{"deleted_at":"2026-08-28T12:00:00Z","operation_id":"delete-op","reason_code":"ACCOUNT_DELETED","terminal":true}`)
	var response TerminateCurrentAccountResponseDto
	if err := json.Unmarshal(valid, &response); err != nil {
		t.Fatalf("valid terminal Account deletion response was rejected: %v", err)
	}

	wrongTerminal := []byte(`{"deleted_at":"2026-08-28T12:00:00Z","operation_id":"delete-op","reason_code":"ACCOUNT_DELETED","terminal":false}`)
	if err := json.Unmarshal(wrongTerminal, &response); err == nil {
		t.Fatal("terminal:false was accepted as a terminal Account deletion response")
	}

	wrongReason := []byte(`{"deleted_at":"2026-08-28T12:00:00Z","operation_id":"delete-op","reason_code":"ACCOUNT_SUSPENDED","terminal":true}`)
	if err := json.Unmarshal(wrongReason, &response); err == nil {
		t.Fatal("non-deletion reason was accepted as a terminal Account deletion response")
	}
}
