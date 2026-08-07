package localappkernel

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"hash"
)

type KeyDeriver struct{ kernel *Kernel }

// Derive roots account-scoped keys in the random Registered App Subject. The
// display App id and registration management handle are deliberately absent.
func (deriver *KeyDeriver) Derive(ctx context.Context, accountID, registeredAppSubject string) (SecurityKeys, error) {
	if deriver == nil || deriver.kernel == nil {
		return SecurityKeys{}, fmt.Errorf("%w: security key deriver", ErrInvalidArgument)
	}
	if err := requireExactText("account_id", accountID); err != nil {
		return SecurityKeys{}, err
	}
	registration, err := deriver.kernel.registrations.GetBySubject(ctx, registeredAppSubject)
	if err != nil {
		return SecurityKeys{}, err
	}
	if registration.State != RegistrationStateActive {
		return SecurityKeys{}, ErrRegistrationTombstoned
	}
	return SecurityKeys{
		StoragePartitionKey: opaqueKey("ras-storage-v1", deriver.kernel.anchor, accountID, registeredAppSubject),
		AudienceKey:         opaqueKey("ras-audience-v1", deriver.kernel.anchor, accountID, registeredAppSubject),
		AuditSubjectKey:     opaqueKey("ras-audit-v1", deriver.kernel.anchor, registeredAppSubject),
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
