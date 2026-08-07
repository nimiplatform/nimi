package account

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestProtectedBinaryCustodyRoundTripsVersionedAccountMaterial(t *testing.T) {
	secrets := newAccountBinarySecretStore()
	custody, err := NewProtectedBinaryCustody(secrets)
	if err != nil {
		t.Fatalf("NewProtectedBinaryCustody: %v", err)
	}
	partition := "account=user-alpha;logon=42"
	avatarURL := "https://cdn.example/avatar.png"
	material := AccountMaterial{
		AccountID:            "account-alpha",
		DisplayName:          "用户\x00Alpha",
		CurrentUserHandle:    "alpha",
		CurrentUserAvatarURL: &avatarURL,
		RealmEnvironmentID:   "realm-production",
		WorkspaceMemberships: []*runtimev1.WorkspaceMembershipProjection{{
			WorkspaceId:        "workspace-alpha",
			MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
			RealmEnvironmentId: "realm-production",
			ObservedAt:         timestamppb.New(time.Date(2026, 7, 10, 2, 3, 4, 5, time.UTC)),
			DisplayMetadata: map[string]string{
				"display_name": "value\x00with\x00nul",
			},
		}},
		AccessToken:        "access\x00token-密钥",
		AccessTokenExpires: time.Date(2026, 7, 10, 3, 4, 5, 6, time.UTC),
		RefreshToken:       "refresh\x00token-私密",
		RefreshTokenHashes: map[string]bool{"hash-a": true, "hash-b": false},
	}

	if err := custody.Store(context.Background(), partition, material); err != nil {
		t.Fatalf("Store: %v", err)
	}
	if strings.Contains(secrets.lastStoreName, "account") || strings.Contains(secrets.lastStoreName, "user-alpha") {
		t.Fatalf("logical name leaked partition material: %q", secrets.lastStoreName)
	}
	if !strings.HasPrefix(secrets.lastStoreName, "acct-v1-") || len(secrets.lastStoreName) > 64 {
		t.Fatalf("logical name must be fixed and Windows-store compatible: %q", secrets.lastStoreName)
	}

	loaded, err := custody.Load(context.Background(), partition)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.AccountID != material.AccountID || loaded.DisplayName != material.DisplayName ||
		loaded.CurrentUserHandle != material.CurrentUserHandle || loaded.CurrentUserAvatarURL == nil ||
		*loaded.CurrentUserAvatarURL != avatarURL || loaded.AccessToken != material.AccessToken || loaded.RefreshToken != material.RefreshToken ||
		!loaded.AccessTokenExpires.Equal(material.AccessTokenExpires) {
		t.Fatalf("round-trip material mismatch: %#v", loaded)
	}
	if len(loaded.WorkspaceMemberships) != 1 ||
		loaded.WorkspaceMemberships[0].GetDisplayMetadata()["display_name"] != "value\x00with\x00nul" ||
		!loaded.WorkspaceMemberships[0].GetObservedAt().AsTime().Equal(material.WorkspaceMemberships[0].GetObservedAt().AsTime()) {
		t.Fatalf("round-trip workspace membership mismatch: %#v", loaded.WorkspaceMemberships)
	}
	if loaded.RefreshTokenHashes["hash-a"] != true || loaded.RefreshTokenHashes["hash-b"] != false {
		t.Fatalf("round-trip refresh hashes mismatch: %#v", loaded.RefreshTokenHashes)
	}

	otherName := protectedAccountSecretName("account=user-alpha;logon=43")
	if otherName == secrets.lastStoreName {
		t.Fatal("distinct verified partitions must not share a logical secret name")
	}
}

func TestProtectedBinaryCustodyMapsMissingAndClearIdempotently(t *testing.T) {
	secrets := newAccountBinarySecretStore()
	custody, err := NewProtectedBinaryCustody(secrets)
	if err != nil {
		t.Fatalf("NewProtectedBinaryCustody: %v", err)
	}
	if _, err := custody.Load(context.Background(), "partition-a"); !errors.Is(err, ErrNoStoredAccount) {
		t.Fatalf("missing protected secret must map to ErrNoStoredAccount, got %v", err)
	}
	if err := custody.Clear(context.Background(), "partition-a"); err != nil {
		t.Fatalf("clear of missing protected secret must be idempotent: %v", err)
	}
}

func TestProtectedBinaryCustodyRejectsMalformedOrUnavailableStore(t *testing.T) {
	if _, err := NewProtectedBinaryCustody(nil); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("nil protected store must fail closed: %v", err)
	}
	secrets := newAccountBinarySecretStore()
	secrets.values[protectedAccountSecretName("partition-a")] = []byte("raw-json-is-not-an-admitted-envelope")
	custody, err := NewProtectedBinaryCustody(secrets)
	if err != nil {
		t.Fatalf("NewProtectedBinaryCustody: %v", err)
	}
	if _, err := custody.Load(context.Background(), "partition-a"); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("malformed protected account material must fail closed: %v", err)
	}
}

func TestProtectedBinaryCustodyRejectsIncompleteProductionMaterial(t *testing.T) {
	complete := AccountMaterial{
		AccountID:          "account-alpha",
		DisplayName:        "Alpha",
		RealmEnvironmentID: "realm-production",
		AccessToken:        "access-token",
		AccessTokenExpires: time.Date(2026, 7, 10, 3, 4, 5, 0, time.UTC),
		RefreshToken:       "refresh-token",
	}
	cases := map[string]func(*AccountMaterial){
		"account id":        func(material *AccountMaterial) { material.AccountID = "" },
		"display name":      func(material *AccountMaterial) { material.DisplayName = "" },
		"realm environment": func(material *AccountMaterial) { material.RealmEnvironmentID = "" },
		"access token":      func(material *AccountMaterial) { material.AccessToken = "" },
		"access expiry":     func(material *AccountMaterial) { material.AccessTokenExpires = time.Time{} },
		"refresh token":     func(material *AccountMaterial) { material.RefreshToken = "" },
	}
	for name, mutate := range cases {
		t.Run("store missing "+name, func(t *testing.T) {
			secrets := newAccountBinarySecretStore()
			custody, err := NewProtectedBinaryCustody(secrets)
			if err != nil {
				t.Fatal(err)
			}
			material := complete
			mutate(&material)
			if err := custody.Store(context.Background(), "partition-a", material); !errors.Is(err, ErrCustodyUnavailable) {
				t.Fatalf("incomplete material error = %v", err)
			}
			if len(secrets.values) != 0 {
				t.Fatal("incomplete material overwrote protected custody")
			}
		})
	}

	secrets := newAccountBinarySecretStore()
	custody, err := NewProtectedBinaryCustody(secrets)
	if err != nil {
		t.Fatal(err)
	}
	secrets.values[protectedAccountSecretName("partition-a")] = encodeProtectedAccountSnapshotFixture(t, custodySnapshot{
		AccountID:          "account-alpha",
		AccessTokenExpires: complete.AccessTokenExpires.Format(time.RFC3339Nano),
	})
	if _, err := custody.Load(context.Background(), "partition-a"); !errors.Is(err, ErrCustodyUnavailable) {
		t.Fatalf("incomplete stored material error = %v", err)
	}
}

func encodeProtectedAccountSnapshotFixture(t *testing.T, snapshot custodySnapshot) []byte {
	t.Helper()
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	encoded := make([]byte, protectedAccountHeaderBytes+len(payload))
	copy(encoded[:8], protectedAccountEncodingMagic)
	binary.BigEndian.PutUint32(encoded[8:12], uint32(len(payload)))
	copy(encoded[12:protectedAccountHeaderBytes], digest[:])
	copy(encoded[protectedAccountHeaderBytes:], payload)
	return encoded
}

type accountBinarySecretStore struct {
	values        map[string][]byte
	lastStoreName string
}

func newAccountBinarySecretStore() *accountBinarySecretStore {
	return &accountBinarySecretStore{values: map[string][]byte{}}
}

func (s *accountBinarySecretStore) Load(_ context.Context, name string) ([]byte, error) {
	value, ok := s.values[name]
	if !ok {
		return nil, protectedlocal.ErrProtectedSecretNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *accountBinarySecretStore) Store(_ context.Context, name string, value []byte) error {
	s.lastStoreName = name
	s.values[name] = append([]byte(nil), value...)
	return nil
}

func (s *accountBinarySecretStore) Delete(_ context.Context, name string) error {
	if _, ok := s.values[name]; !ok {
		return protectedlocal.ErrProtectedSecretNotFound
	}
	delete(s.values, name)
	return nil
}
