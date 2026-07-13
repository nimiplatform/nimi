package localappkernel

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"hash"
)

type KeyDeriver struct {
	kernel *Kernel
}

// Derive returns opaque keys rooted only in the Runtime-derived OS-user
// partition, account, and random principal. app_id is deliberately absent.
func (deriver *KeyDeriver) Derive(ctx context.Context, accountID string, principalID string) (SecurityKeys, error) {
	if deriver == nil || deriver.kernel == nil {
		return SecurityKeys{}, fmt.Errorf("%w: security key deriver", ErrInvalidArgument)
	}
	if err := requireExactText("account_id", accountID); err != nil {
		return SecurityKeys{}, err
	}
	if err := requireExactText("local_app_principal_id", principalID); err != nil {
		return SecurityKeys{}, err
	}
	principal, err := deriver.kernel.principals.Get(ctx, principalID)
	if err != nil {
		return SecurityKeys{}, err
	}
	if principal.State != PrincipalStateActive {
		return SecurityKeys{}, ErrPrincipalTombstoned
	}
	return SecurityKeys{
		StoragePartitionKey: opaqueKey("lap-storage-v1", deriver.kernel.anchor, accountID, principalID),
		AudienceKey:         opaqueKey("lap-audience-v1", deriver.kernel.anchor, accountID, principalID),
		AuditSubjectKey:     opaqueKey("lap-audit-v1", deriver.kernel.anchor, principalID),
	}, nil
}

func opaqueKey(domain string, components ...string) string {
	digest := sha256.New()
	writeLengthPrefixed(digest, domain)
	for _, component := range components {
		writeLengthPrefixed(digest, component)
	}
	return domain + "_" + base64.RawURLEncoding.EncodeToString(digest.Sum(nil))
}

func writeLengthPrefixed(target hash.Hash, value string) {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	_, _ = target.Write(length[:])
	_, _ = target.Write([]byte(value))
}
