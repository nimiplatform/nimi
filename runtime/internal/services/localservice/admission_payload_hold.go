package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// admissionPayloadHold is a bound payload file this Runtime process has kept
// open without write sharing since before it hashed the file. While the hold
// stays open no write open or writable mapping of the file can succeed, so the
// digest stays true for later admissions of the same file identity.
type admissionPayloadHold struct {
	file       *os.File
	identity   modelFileIdentity
	generation string
	sha256     string
}

// admittedPayload is one payload verification made during an admission. hold
// is a new hold this admission opened before hashing and owns until it is
// retained. borrowed is set instead when the digest comes from an earlier
// admission and stays valid only while that retained hold does.
type admittedPayload struct {
	identity   modelFileIdentity
	generation string
	sha256     string
	hold       *os.File
	borrowed   *admissionPayloadHold
}

// admissionPass carries the verifications one admission made before it took
// the mutation locks. The locked capture accepts one only for the same file
// identity and generation, and a borrowed digest only while the same hold is
// still retained; close releases every hold it did not retain.
type admissionPass map[string]admittedPayload

func (pass admissionPass) close() {
	for key, payload := range pass {
		if payload.hold != nil {
			_ = payload.hold.Close()
		}
		delete(pass, key)
	}
}

func admissionPayloadKey(path string) string {
	return filepath.Clean(strings.TrimSpace(path))
}

// @nimi-authority: rule.nimi.runtime.local-compute.r100
// verifyAdmissionPayload verifies one bound payload for Local Job admission and
// returns its digest with the file identity it verified. An earlier admission's
// digest is reused only through a retained hold on the same file; otherwise the
// file is hashed, through a new hold when it can be held. File-system change
// markers never justify reuse, so a payload that cannot be held is hashed by
// every admission.
func (s *Service) verifyAdmissionPayload(ctx context.Context, path string, info os.FileInfo, generationDigest string) (admittedPayload, error) {
	key := admissionPayloadKey(path)
	generation := strings.TrimSpace(generationDigest)
	if reused, ok := s.reuseAdmissionHold(key, generation); ok {
		return reused, nil
	}
	file, identity, holdable, err := openAdmissionPayloadHold(key)
	if err != nil {
		return admittedPayload{}, err
	}
	if !holdable {
		// Nothing keeps writers out, so this digest serves this admission only.
		before, _, err := modelFileIdentityOf(key)
		if err != nil {
			return admittedPayload{}, err
		}
		sum, err := s.freshFileSHA256Context(ctx, key, info, generation, nil)
		if err != nil {
			return admittedPayload{}, err
		}
		after, _, err := modelFileIdentityOf(key)
		if err != nil {
			return admittedPayload{}, err
		}
		if after != before {
			return admittedPayload{}, fmt.Errorf("file changed during sha256 verification: %s", key)
		}
		return admittedPayload{identity: before, generation: generation, sha256: sum}, nil
	}
	sum, err := s.freshFileSHA256Context(ctx, key, info, generation, file)
	if err == nil {
		// The digest describes the held file, so the path must still name it.
		current, _, identityErr := modelFileIdentityOf(key)
		switch {
		case identityErr != nil:
			err = identityErr
		case current != identity:
			err = fmt.Errorf("file changed during sha256 verification: %s", key)
		}
	}
	if err != nil {
		_ = file.Close()
		return admittedPayload{}, err
	}
	return admittedPayload{identity: identity, generation: generation, sha256: sum, hold: file}, nil
}

// admitPayloadLocked verifies one payload inside the locked capture. It accepts
// this admission's earlier verification only while it still stands, and
// retains any new hold for later admissions; otherwise it verifies again.
// Callers hold modelAssetMutationMu, so a hold is never retained during a
// ModelAsset change.
func (s *Service) admitPayloadLocked(ctx context.Context, pass admissionPass, path string, info os.FileInfo, generationDigest string) (string, error) {
	key := admissionPayloadKey(path)
	generation := strings.TrimSpace(generationDigest)
	if earlier, ok := pass[key]; ok {
		if s.admittedPayloadStands(key, generation, earlier) {
			s.retainAdmissionPayload(key, earlier)
			earlier.hold = nil
			pass[key] = earlier
			return earlier.sha256, nil
		}
		if earlier.hold != nil {
			_ = earlier.hold.Close()
		}
		delete(pass, key)
	}
	payload, err := s.verifyAdmissionPayload(ctx, key, info, generation)
	if err != nil {
		return "", err
	}
	s.retainAdmissionPayload(key, payload)
	payload.hold = nil
	if pass != nil {
		pass[key] = payload
	}
	return payload.sha256, nil
}

// admittedPayloadStands reports whether an earlier verification of this
// admission still holds for the path under the mutation locks. A digest the
// admission hashed itself needs the same file identity and generation. A
// borrowed digest also needs the very hold it came from to be retained and open
// still: any release ends the hold's proof, even if another hold now exists
// for the path, and file identity says nothing about the bytes.
func (s *Service) admittedPayloadStands(key string, generation string, earlier admittedPayload) bool {
	if earlier.generation != generation {
		return false
	}
	current, _, err := modelFileIdentityOf(key)
	if err != nil || current != earlier.identity {
		return false
	}
	if earlier.borrowed == nil {
		return true
	}
	s.mu.RLock()
	retained := s.admissionHolds[key] == earlier.borrowed
	s.mu.RUnlock()
	held, heldOK := heldPayloadIdentity(earlier.borrowed.file)
	return retained && heldOK && held == earlier.identity
}

// reuseAdmissionHold returns a retained digest, with the hold it depends on,
// while the hold still refers to the file the path names. A hold whose file the
// path no longer names is closed.
func (s *Service) reuseAdmissionHold(key string, generation string) (admittedPayload, bool) {
	s.mu.RLock()
	hold := s.admissionHolds[key]
	s.mu.RUnlock()
	if hold == nil || hold.generation != generation {
		return admittedPayload{}, false
	}
	held, heldOK := heldPayloadIdentity(hold.file)
	current, _, err := modelFileIdentityOf(key)
	if heldOK && err == nil && held == hold.identity && current == hold.identity {
		return admittedPayload{identity: hold.identity, generation: generation, sha256: hold.sha256, borrowed: hold}, true
	}
	s.mu.Lock()
	retained := s.admissionHolds[key] == hold
	if retained {
		delete(s.admissionHolds, key)
	}
	s.mu.Unlock()
	if retained {
		_ = hold.file.Close()
	}
	return admittedPayload{}, false
}

// retainAdmissionPayload keeps a verification's new hold for later admissions.
// Callers hold modelAssetMutationMu.
func (s *Service) retainAdmissionPayload(key string, payload admittedPayload) {
	if payload.hold == nil {
		return
	}
	hold := &admissionPayloadHold{file: payload.hold, identity: payload.identity, generation: payload.generation, sha256: payload.sha256}
	s.mu.Lock()
	if s.admissionHolds == nil {
		s.admissionHolds = make(map[string]*admissionPayloadHold)
	}
	previous := s.admissionHolds[key]
	s.admissionHolds[key] = hold
	s.mu.Unlock()
	if previous != nil {
		_ = previous.file.Close()
	}
}

// releaseAdmissionHolds closes every retained hold, after which admissions
// hash their payloads again.
func (s *Service) releaseAdmissionHolds() {
	s.mu.Lock()
	holds := s.admissionHolds
	s.admissionHolds = make(map[string]*admissionPayloadHold)
	s.mu.Unlock()
	for _, hold := range holds {
		_ = hold.file.Close()
	}
}

// lockModelAssetMutation takes modelAssetMutationMu for a ModelAsset change and
// first releases every admission hold, so the change never meets a payload file
// that admission keeps open.
func (s *Service) lockModelAssetMutation() {
	s.modelAssetMutationMu.Lock()
	s.releaseAdmissionHolds()
}

// computeFileSHA256Context hashes one payload file and stops when ctx ends.
// The file stays deletable by Runtime reclamation while it is read.
func computeFileSHA256Context(ctx context.Context, path string) (string, error) {
	file, err := openVerificationFile(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	return hashFileContext(ctx, file)
}

// hashFileContext hashes a freshly opened file to its end in 4 MiB reads and
// stops when ctx ends.
func hashFileContext(ctx context.Context, file *os.File) (string, error) {
	hasher := sha256.New()
	buffer := make([]byte, 4<<20)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		read, readErr := file.Read(buffer)
		if read > 0 {
			_, _ = hasher.Write(buffer[:read])
		}
		if readErr == io.EOF {
			return hex.EncodeToString(hasher.Sum(nil)), nil
		}
		if readErr != nil {
			return "", readErr
		}
	}
}
