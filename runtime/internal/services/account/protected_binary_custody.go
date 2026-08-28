package account

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	protectedAccountEncodingMagic = "NIMIAC01"
	protectedAccountHeaderBytes   = 8 + 4 + sha256.Size
	protectedAccountMaxJSONBytes  = 1024 * 1024
	protectedAccountNameDomain    = "nimi.runtime.account.custody.v1"
)

type protectedBinaryCustody struct {
	secrets protectedlocal.BinarySecretStore
}

// NewProtectedBinaryCustody adapts Runtime-private binary custody to the
// account service. It does not select an OS store, path, environment value, or
// portable keyring; production startup must inject an already-verified store.
func NewProtectedBinaryCustody(secrets protectedlocal.BinarySecretStore) (Custody, error) {
	if secrets == nil {
		return nil, ErrCustodyUnavailable
	}
	return &protectedBinaryCustody{secrets: secrets}, nil
}

func (custody *protectedBinaryCustody) Load(ctx context.Context, partition string) (AccountMaterial, error) {
	name, err := resolveProtectedAccountSecretName(partition)
	if err != nil {
		return AccountMaterial{}, err
	}
	encoded, err := custody.secrets.Load(ctx, name)
	if errors.Is(err, protectedlocal.ErrProtectedSecretNotFound) {
		return AccountMaterial{}, ErrNoStoredAccount
	}
	if err != nil {
		return AccountMaterial{}, protectedAccountCustodyError("load", err)
	}
	defer zeroProtectedAccountBytes(encoded)
	material, err := decodeProtectedAccountMaterial(encoded)
	if err != nil {
		return AccountMaterial{}, protectedAccountCustodyError("decode", err)
	}
	return material, nil
}

func (custody *protectedBinaryCustody) Store(ctx context.Context, partition string, material AccountMaterial) error {
	name, err := resolveProtectedAccountSecretName(partition)
	if err != nil {
		return err
	}
	encoded, err := encodeProtectedAccountMaterial(material)
	if err != nil {
		return protectedAccountCustodyError("encode", err)
	}
	defer zeroProtectedAccountBytes(encoded)
	if err := custody.secrets.Store(ctx, name, encoded); err != nil {
		return protectedAccountCustodyError("store", err)
	}
	return nil
}

func (custody *protectedBinaryCustody) Clear(ctx context.Context, partition string) error {
	name, err := resolveProtectedAccountSecretName(partition)
	if err != nil {
		return err
	}
	if err := custody.secrets.Delete(ctx, name); err != nil && !errors.Is(err, protectedlocal.ErrProtectedSecretNotFound) {
		return protectedAccountCustodyError("clear", err)
	}
	return nil
}

func resolveProtectedAccountSecretName(partition string) (string, error) {
	normalized := strings.TrimSpace(partition)
	if normalized == "" {
		return "", protectedAccountCustodyError("resolve partition", errors.New("verified account partition is empty"))
	}
	return protectedAccountSecretName(normalized), nil
}

func protectedAccountSecretName(partition string) string {
	digest := sha256.Sum256([]byte(protectedAccountNameDomain + "\x00" + strings.TrimSpace(partition)))
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(digest[:])
	return "acct-v1-" + strings.ToLower(encoded)
}

func encodeProtectedAccountMaterial(material AccountMaterial) ([]byte, error) {
	if err := validateProtectedAccountMaterial(material); err != nil {
		return nil, err
	}
	material = normalizeMaterial(material)
	if err := validateProtectedAccountMaterial(material); err != nil {
		return nil, err
	}
	for _, membership := range material.WorkspaceMemberships {
		if observedAt := membership.GetObservedAt(); observedAt != nil {
			if err := observedAt.CheckValid(); err != nil {
				return nil, fmt.Errorf("invalid workspace observed time: %w", err)
			}
		}
	}
	snapshot := custodySnapshot{
		AccountID:            material.AccountID,
		DisplayName:          material.DisplayName,
		CurrentUserHandle:    material.CurrentUserHandle,
		CurrentUserAvatarURL: material.CurrentUserAvatarURL,
		RealmEnvironmentID:   material.RealmEnvironmentID,
		RealmOrigin:          material.RealmOrigin,
		WorkspaceMemberships: workspaceMembershipSnapshotsFromProjections(material.WorkspaceMemberships),
		AccessToken:          material.AccessToken,
		AccessTokenExpires:   material.AccessTokenExpires.UTC().Format(time.RFC3339Nano),
		RefreshToken:         material.RefreshToken,
		RefreshTokenHashes:   material.RefreshTokenHashes,
		PendingRealmDeletion: realmAccountDeletionSnapshotFromMaterial(material),
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("marshal account material: %w", err)
	}
	defer zeroProtectedAccountBytes(payload)
	if len(payload) == 0 || len(payload) > protectedAccountMaxJSONBytes {
		return nil, errors.New("account material length outside fixed bounds")
	}
	digest := sha256.Sum256(payload)
	encoded := make([]byte, protectedAccountHeaderBytes+len(payload))
	copy(encoded[:8], protectedAccountEncodingMagic)
	binary.BigEndian.PutUint32(encoded[8:12], uint32(len(payload)))
	copy(encoded[12:protectedAccountHeaderBytes], digest[:])
	copy(encoded[protectedAccountHeaderBytes:], payload)
	return encoded, nil
}

func decodeProtectedAccountMaterial(encoded []byte) (AccountMaterial, error) {
	if len(encoded) < protectedAccountHeaderBytes || string(encoded[:8]) != protectedAccountEncodingMagic {
		return AccountMaterial{}, errors.New("invalid account material encoding")
	}
	payloadLength := int(binary.BigEndian.Uint32(encoded[8:12]))
	if payloadLength <= 0 || payloadLength > protectedAccountMaxJSONBytes || payloadLength != len(encoded)-protectedAccountHeaderBytes {
		return AccountMaterial{}, errors.New("invalid account material length")
	}
	payload := encoded[protectedAccountHeaderBytes:]
	digest := sha256.Sum256(payload)
	if subtle.ConstantTimeCompare(encoded[12:protectedAccountHeaderBytes], digest[:]) != 1 {
		return AccountMaterial{}, errors.New("account material integrity mismatch")
	}
	var snapshot custodySnapshot
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return AccountMaterial{}, fmt.Errorf("parse account material: %w", err)
	}
	if err := expectProtectedAccountJSONEOF(decoder); err != nil {
		return AccountMaterial{}, err
	}
	if strings.TrimSpace(snapshot.AccountID) == "" {
		return AccountMaterial{}, errors.New("account material has empty account id")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, snapshot.AccessTokenExpires)
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("parse access token expiry: %w", err)
	}
	for _, membership := range snapshot.WorkspaceMemberships {
		if membership.ObservedAt == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339Nano, membership.ObservedAt)
		if err != nil {
			return AccountMaterial{}, fmt.Errorf("parse workspace observed time: %w", err)
		}
		if err := timestamppb.New(parsed).CheckValid(); err != nil {
			return AccountMaterial{}, fmt.Errorf("validate workspace observed time: %w", err)
		}
	}
	material := AccountMaterial{
		AccountID:            snapshot.AccountID,
		DisplayName:          snapshot.DisplayName,
		CurrentUserHandle:    snapshot.CurrentUserHandle,
		CurrentUserAvatarURL: snapshot.CurrentUserAvatarURL,
		RealmEnvironmentID:   snapshot.RealmEnvironmentID,
		RealmOrigin:          snapshot.RealmOrigin,
		WorkspaceMemberships: workspaceMembershipsFromSnapshots(snapshot.WorkspaceMemberships),
		AccessToken:          snapshot.AccessToken,
		AccessTokenExpires:   expiresAt,
		RefreshToken:         snapshot.RefreshToken,
		RefreshTokenHashes:   snapshot.RefreshTokenHashes,
	}
	if snapshot.PendingRealmDeletion != nil {
		deletedAt, parseErr := time.Parse(time.RFC3339Nano, snapshot.PendingRealmDeletion.DeletedAt)
		if parseErr != nil {
			return AccountMaterial{}, fmt.Errorf("parse pending Realm Account deletion time: %w", parseErr)
		}
		pending, pendingErr := NewObservedRealmAccountDeletedResult(
			snapshot.PendingRealmDeletion.AccountID,
			snapshot.PendingRealmDeletion.OperationID,
			deletedAt,
			snapshot.PendingRealmDeletion.Reason,
		)
		if pendingErr != nil || pending.AccountID() != material.AccountID {
			return AccountMaterial{}, errors.New("pending Realm Account deletion is invalid")
		}
		material.pendingRealmDeletion = &pending
	}
	if err := validateProtectedAccountMaterial(material); err != nil {
		return AccountMaterial{}, err
	}
	return normalizeMaterial(material), nil
}

func realmAccountDeletionSnapshotFromMaterial(material AccountMaterial) *realmAccountDeletionSnapshot {
	if material.pendingRealmDeletion == nil || !material.pendingRealmDeletion.Observed() {
		return nil
	}
	return &realmAccountDeletionSnapshot{
		AccountID:   material.pendingRealmDeletion.AccountID(),
		OperationID: material.pendingRealmDeletion.OperationID(),
		DeletedAt:   material.pendingRealmDeletion.DeletedAt().UTC().Format(time.RFC3339Nano),
		Reason:      material.pendingRealmDeletion.Reason(),
	}
}

func validateProtectedAccountMaterial(material AccountMaterial) error {
	required := []struct {
		name  string
		value string
	}{
		{name: "account id", value: material.AccountID},
		{name: "display name", value: material.DisplayName},
		{name: "Realm environment id", value: material.RealmEnvironmentID},
		{name: "access token", value: material.AccessToken},
		{name: "refresh token", value: material.RefreshToken},
	}
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%s is empty", field.name)
		}
	}
	if material.CurrentUserHandle != "" {
		if _, err := requiredCurrentUserDisplayTextValue(material.CurrentUserHandle, 160); err != nil {
			return errors.New("Current User handle is invalid")
		}
	} else if material.CurrentUserAvatarURL != nil {
		return errors.New("Current User avatar has no handle")
	}
	if material.CurrentUserAvatarURL != nil {
		if _, err := safeCurrentUserAvatarURL(*material.CurrentUserAvatarURL, material.RealmOrigin); err != nil {
			return errors.New("Current User avatar URL is invalid")
		}
	}
	if material.AccessTokenExpires.IsZero() || material.AccessTokenExpires.Year() < 1 || material.AccessTokenExpires.Year() > 9999 {
		return errors.New("access token expiry is missing or outside RFC3339 bounds")
	}
	if pending := material.pendingRealmDeletion; pending != nil &&
		(!pending.Observed() || pending.AccountID() != material.AccountID || pending.Reason() != RealmAccountDeletedReason) {
		return errors.New("pending Realm Account deletion is invalid")
	}
	return nil
}

func expectProtectedAccountJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("account material has trailing JSON value")
		}
		return fmt.Errorf("parse trailing account material: %w", err)
	}
	return nil
}

func protectedAccountCustodyError(operation string, err error) error {
	return fmt.Errorf("%w: protected account custody %s: %w", ErrCustodyUnavailable, operation, err)
}

func zeroProtectedAccountBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
