package coregenerated

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type realmNullableResponseTransport struct {
	body []byte
	err  error
}

func (transport realmNullableResponseTransport) Unary(context.Context, sdkstypes.CoreUnaryRequest) ([]byte, error) {
	return transport.body, transport.err
}

func (realmNullableResponseTransport) ServerStream(context.Context, sdkstypes.CoreStreamRequest) (coreclient.StreamReader, error) {
	return nil, errors.New("unexpected streaming request")
}

func TestRealmNullableResponsePreservesAbsentAndPresentTransit(t *testing.T) {
	transportFailure := errors.New("transport unavailable")
	for _, test := range []struct {
		name      string
		body      string
		transport error
		wantError bool
		wantID    string
	}{
		{name: "absent", body: "null"},
		{name: "present", body: `{
			"createdAt":"2026-09-16T00:00:00Z","id":"transit-1","runtimeSourceRef":"source-1",
			"sourceRef":{"kind":"worldCharacter","id":"character-1","sourceHash":"hash-1","worldId":"world-1",
				"worldEntityRef":{"kind":"worldEntity","worldId":"world-1","entityId":"entity-1"}},
			"status":"PENDING","toWorldId":"world-2","transitType":"VISIT","userId":"account-1"
		}`, wantID: "transit-1"},
		{name: "missing fields", body: "{}", wantError: true},
		{name: "wrong type", body: "false", wantError: true},
		{name: "transport failure", transport: transportFailure, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := NewRealmTypedClient(coreclient.New(realmNullableResponseTransport{body: []byte(test.body), err: test.transport}, nil))
			result, err := client.TransitControllerGetActiveTransit(context.Background(), RealmTransitControllerGetActiveTransitOperationRequest{}, nil, 0)
			if (err != nil) != test.wantError {
				t.Fatalf("result=%+v error=%v; wantError=%v", result, err, test.wantError)
			}
			if test.transport != nil && !errors.Is(err, test.transport) {
				t.Fatalf("transport error was lost: %v", err)
			}
			if test.wantError {
				return
			}
			if test.wantID == "" {
				if result != nil {
					t.Fatalf("null response became a record: %+v", result)
				}
			} else if result == nil || result.Id != test.wantID {
				t.Fatalf("non-null response was lost: %+v", result)
			}
		})
	}
}

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
