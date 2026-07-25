package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

const (
	localDevelopmentPayloadMaxFiles = 20_000
	localDevelopmentPayloadMaxBytes = int64(1 << 30)
)

var localDevelopmentPayloadExcludedDirectories = map[string]struct{}{
	".git": {}, ".cache": {}, ".nimi": {}, "node_modules": {}, "target": {},
}

type localDevelopmentExecutionObservation struct {
	CanonicalProjectFileID string
	HostExecutableDigest   string
	PayloadRootDigest      string
}

func (s *Service) observeLocalDevelopmentExecution(project localDevelopmentProjectSnapshot) (localDevelopmentExecutionObservation, error) {
	if s == nil || s.localAppKernel == nil {
		return localDevelopmentExecutionObservation{}, localappkernel.ErrNotFound
	}
	projectFileID, err := localDevelopmentCanonicalProjectFileID(project.ProjectRoot)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	hostExecutable, err := localDevelopmentHostExecutable(project)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	hostDigest, err := localDevelopmentFileDigest(hostExecutable)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	payloadDigest, err := localDevelopmentProjectPayloadDigest(project.ProjectRoot)
	if err != nil {
		return localDevelopmentExecutionObservation{}, err
	}
	return localDevelopmentExecutionObservation{
		CanonicalProjectFileID: projectFileID,
		HostExecutableDigest:   localDevelopmentDigestRef("host", hostDigest),
		PayloadRootDigest:      localDevelopmentDigestRef("payload", payloadDigest),
	}, nil
}

func (s *Service) createLocalDevelopmentProjection(ctx context.Context, authorization localDevelopmentAuthorization, observation localDevelopmentExecutionObservation) (localappkernel.Principal, localappkernel.Record, error) {
	authorizationRef := localDevelopmentAuthorizationRef(authorization.ID)
	principal, err := s.localAppKernel.Principals().Create(ctx, localappkernel.CreatePrincipalInput{
		Kind:                       localappkernel.PrincipalKindDevelopment,
		AppID:                      authorization.Project.AppID,
		DevelopmentAuthorizationID: authorizationRef,
		CanonicalProjectFileID:     observation.CanonicalProjectFileID,
	})
	if err != nil {
		return localappkernel.Principal{}, localappkernel.Record{}, err
	}
	created := false
	defer func() {
		if !created {
			_, _ = s.localAppKernel.Principals().Tombstone(context.Background(), principal.LocalAppPrincipalID)
		}
	}()
	record, err := s.createLocalDevelopmentRecord(ctx, authorization, principal, observation)
	if err != nil {
		return localappkernel.Principal{}, localappkernel.Record{}, err
	}
	created = true
	return principal, record, nil
}

func (s *Service) createLocalDevelopmentRecord(ctx context.Context, authorization localDevelopmentAuthorization, principal localappkernel.Principal, observation localDevelopmentExecutionObservation) (localappkernel.Record, error) {
	return s.localAppKernel.Records().Create(ctx, localappkernel.CreateRecordInput{
		LocalAppPrincipalID:               principal.LocalAppPrincipalID,
		TrustClass:                        localappkernel.TrustClassLocalDevelopment,
		ProvenanceAttestationRefs:         []string{localDevelopmentConsentAttestationRef(authorization.ID)},
		ProvenanceRevision:                1,
		ActiveReleaseOrProjectIdentityRef: localDevelopmentProjectIdentityRef(observation.CanonicalProjectFileID),
		InstallOrProjectGeneration:        1,
		ActiveCapabilityFingerprint:       localDevelopmentCapabilityRef(authorization.Project.PermissionRequirementFingerprint),
		ExecutionProfileRef:               localDevelopmentExecutionProfileRef(authorization.Project.ShellKind),
		HostExecutableDigest:              observation.HostExecutableDigest,
		PayloadRootDigest:                 observation.PayloadRootDigest,
		LifecycleState:                    localappkernel.LifecycleStateActive,
	})
}

func (s *Service) prepareLocalDevelopmentRecord(ctx context.Context, authorization localDevelopmentAuthorization) (localappkernel.Principal, localappkernel.Record, error) {
	if s == nil || s.localAppKernel == nil {
		return localappkernel.Principal{}, localappkernel.Record{}, localappkernel.ErrNotFound
	}
	observation, err := s.observeLocalDevelopmentExecution(authorization.Project)
	if err != nil {
		return localappkernel.Principal{}, localappkernel.Record{}, err
	}
	authorizationRef := localDevelopmentAuthorizationRef(authorization.ID)
	principal, lookupErr := s.localAppKernel.Principals().GetByDevelopmentAuthorizationID(ctx, authorizationRef)
	if errors.Is(lookupErr, localappkernel.ErrNotFound) || (lookupErr == nil && principal.State == localappkernel.PrincipalStateTombstoned) {
		created, record, createErr := s.createLocalDevelopmentProjection(ctx, authorization, observation)
		if createErr == nil {
			return created, record, nil
		}
		if !errors.Is(createErr, localappkernel.ErrStateConflict) {
			return localappkernel.Principal{}, localappkernel.Record{}, createErr
		}
		principal, lookupErr = s.localAppKernel.Principals().GetByDevelopmentAuthorizationID(ctx, authorizationRef)
	}
	if lookupErr != nil {
		return localappkernel.Principal{}, localappkernel.Record{}, lookupErr
	}
	if !localDevelopmentPrincipalMatchesAuthorization(principal, authorization, observation) {
		return localappkernel.Principal{}, localappkernel.Record{}, errLocalDevelopmentProjectChanged
	}

	record, recordErr := s.localAppKernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
	if errors.Is(recordErr, localappkernel.ErrNotFound) {
		record, recordErr = s.createLocalDevelopmentRecord(ctx, authorization, principal, observation)
		if recordErr != nil {
			record, recordErr = s.localAppKernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
		}
	}
	if recordErr != nil {
		return localappkernel.Principal{}, localappkernel.Record{}, recordErr
	}
	if !localDevelopmentRecordMatchesAuthorization(record, authorization, observation) {
		return localappkernel.Principal{}, localappkernel.Record{}, errLocalDevelopmentProjectChanged
	}
	record, recordErr = s.updateLocalDevelopmentRecord(ctx, principal, record, observation)
	return principal, record, recordErr
}

func (s *Service) updateLocalDevelopmentRecord(ctx context.Context, principal localappkernel.Principal, record localappkernel.Record, observation localDevelopmentExecutionObservation) (localappkernel.Record, error) {
	updated, err := s.localAppKernel.Records().UpdateDevelopment(ctx, localappkernel.UpdateDevelopmentRecordInput{
		LocalAppPrincipalID:       principal.LocalAppPrincipalID,
		LocalAppRecordID:          record.LocalAppRecordID,
		ExpectedProjectGeneration: record.InstallOrProjectGeneration,
		HostExecutableDigest:      observation.HostExecutableDigest,
		PayloadRootDigest:         observation.PayloadRootDigest,
		LifecycleState:            localappkernel.LifecycleStateActive,
	})
	if err == nil || !errors.Is(err, localappkernel.ErrRevisionConflict) {
		return updated, err
	}
	current, rereadErr := s.localAppKernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
	if rereadErr != nil {
		return localappkernel.Record{}, rereadErr
	}
	if current.LocalAppRecordID != record.LocalAppRecordID ||
		current.HostExecutableDigest != observation.HostExecutableDigest ||
		current.PayloadRootDigest != observation.PayloadRootDigest ||
		current.LifecycleState != localappkernel.LifecycleStateActive {
		return localappkernel.Record{}, localappkernel.ErrRevisionConflict
	}
	return current, nil
}

func localDevelopmentPrincipalMatchesAuthorization(principal localappkernel.Principal, authorization localDevelopmentAuthorization, observation localDevelopmentExecutionObservation) bool {
	return principal.State == localappkernel.PrincipalStateActive &&
		principal.Kind == localappkernel.PrincipalKindDevelopment &&
		principal.AppID == authorization.Project.AppID &&
		principal.DevelopmentAuthorizationID == localDevelopmentAuthorizationRef(authorization.ID) &&
		principal.CanonicalProjectFileID == observation.CanonicalProjectFileID
}

func localDevelopmentRecordMatchesAuthorization(record localappkernel.Record, authorization localDevelopmentAuthorization, observation localDevelopmentExecutionObservation) bool {
	return record.TrustClass == localappkernel.TrustClassLocalDevelopment &&
		record.LifecycleState == localappkernel.LifecycleStateActive &&
		len(record.ProvenanceAttestationRefs) == 1 &&
		record.ProvenanceAttestationRefs[0] == localDevelopmentConsentAttestationRef(authorization.ID) &&
		record.ActiveReleaseOrProjectIdentityRef == localDevelopmentProjectIdentityRef(observation.CanonicalProjectFileID) &&
		record.ActiveCapabilityFingerprint == localDevelopmentCapabilityRef(authorization.Project.PermissionRequirementFingerprint) &&
		record.ExecutionProfileRef == localDevelopmentExecutionProfileRef(authorization.Project.ShellKind)
}

func localDevelopmentPreparationInvalidatesAuthorization(err error) bool {
	return errors.Is(err, errLocalDevelopmentProjectChanged)
}

func (s *Service) resolveLocalDevelopmentRecord(ctx context.Context, session localDevelopmentSessionProjection) (localappkernel.Principal, localappkernel.Record, error) {
	if s == nil || s.localAppKernel == nil || strings.TrimSpace(session.LocalAppPrincipalID) == "" || strings.TrimSpace(session.LocalAppRecordID) == "" || session.ProvenanceRevision == 0 || session.ProjectGeneration == 0 || strings.TrimSpace(session.PayloadDigest) == "" {
		return localappkernel.Principal{}, localappkernel.Record{}, errLocalDevelopmentSessionRevoked
	}
	principal, err := s.localAppKernel.Principals().Get(ctx, session.LocalAppPrincipalID)
	if err != nil || principal.State != localappkernel.PrincipalStateActive || principal.DevelopmentAuthorizationID != localDevelopmentAuthorizationRef(session.AuthorizationID) || principal.AppID != session.AppID {
		return localappkernel.Principal{}, localappkernel.Record{}, errLocalDevelopmentSessionRevoked
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, session.LocalAppPrincipalID)
	if err != nil || record.LocalAppRecordID != session.LocalAppRecordID || record.ProvenanceRevision != session.ProvenanceRevision || record.InstallOrProjectGeneration != session.ProjectGeneration || record.PayloadRootDigest != session.PayloadDigest || record.ActiveCapabilityFingerprint != localDevelopmentCapabilityRef(session.PermissionRequirementFingerprint) || record.LifecycleState != localappkernel.LifecycleStateActive || localDevelopmentProcessDigestRef(session.Process) != record.HostExecutableDigest {
		return localappkernel.Principal{}, localappkernel.Record{}, errLocalDevelopmentSessionRevoked
	}
	return principal, record, nil
}

func (s *Service) transitionLocalDevelopmentRecord(ctx context.Context, authorization localDevelopmentAuthorization, lifecycle localappkernel.LifecycleState, tombstone bool) error {
	if s == nil || s.localAppKernel == nil {
		return localappkernel.ErrNotFound
	}
	principal, err := s.localAppKernel.Principals().GetByDevelopmentAuthorizationID(ctx, localDevelopmentAuthorizationRef(authorization.ID))
	if errors.Is(err, localappkernel.ErrNotFound) || errors.Is(err, localappkernel.ErrPrincipalTombstoned) || principal.State == localappkernel.PrincipalStateTombstoned {
		return nil
	}
	if err != nil {
		return err
	}
	if tombstone {
		_, err = s.localAppKernel.Principals().Tombstone(ctx, principal.LocalAppPrincipalID)
		if errors.Is(err, localappkernel.ErrPrincipalTombstoned) {
			return nil
		}
		return err
	}
	record, err := s.localAppKernel.Records().GetByPrincipalID(ctx, principal.LocalAppPrincipalID)
	if err != nil {
		return err
	}
	_, err = s.localAppKernel.Records().UpdateDevelopment(ctx, localappkernel.UpdateDevelopmentRecordInput{
		LocalAppPrincipalID:       principal.LocalAppPrincipalID,
		LocalAppRecordID:          record.LocalAppRecordID,
		ExpectedProjectGeneration: record.InstallOrProjectGeneration,
		HostExecutableDigest:      record.HostExecutableDigest,
		PayloadRootDigest:         record.PayloadRootDigest,
		LifecycleState:            lifecycle,
	})
	return err
}

func localDevelopmentAuthorizationRef(identifier protectedlocal.Identifier) string {
	return "lda_v1_" + base64.RawURLEncoding.EncodeToString(identifier[:])
}

func localDevelopmentCapabilityRef(identifier protectedlocal.Identifier) string {
	return "lac_v1_" + base64.RawURLEncoding.EncodeToString(identifier[:])
}

func localDevelopmentExecutionProfileRef(shell any) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("nimi.local-development-execution-profile.v1\x00%v", shell)))
	return "laep_v1_" + base64.RawURLEncoding.EncodeToString(digest[:])
}

func localDevelopmentProjectIdentityRef(fileID string) string {
	digest := sha256.Sum256([]byte("nimi.local-development-project-identity.v1\x00" + fileID))
	return "lapi_v1_" + base64.RawURLEncoding.EncodeToString(digest[:])
}

func localDevelopmentConsentAttestationRef(identifier protectedlocal.Identifier) string {
	digest := sha256.New()
	_, _ = digest.Write([]byte("nimi.local-development-consent-attestation.v1\x00"))
	_, _ = digest.Write(identifier[:])
	return "lapa_v1_" + base64.RawURLEncoding.EncodeToString(digest.Sum(nil))
}

func localDevelopmentDigestRef(kind string, digest protectedlocal.Identifier) string {
	return "lad_v1_" + kind + "_" + base64.RawURLEncoding.EncodeToString(digest[:])
}

func localDevelopmentDigestIdentifier(kind string, value string) (protectedlocal.Identifier, error) {
	prefix := "lad_v1_" + kind + "_"
	if !strings.HasPrefix(value, prefix) {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil || len(decoded) != protectedlocal.IdentifierBytes {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	var result protectedlocal.Identifier
	copy(result[:], decoded)
	if result == (protectedlocal.Identifier{}) {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	return result, nil
}

func localDevelopmentProcessDigestRef(process protectedlocal.ProcessTuple) string {
	return localDevelopmentDigestRef("host", process.ExecutableDigest)
}

func localDevelopmentFileDigest(path string) (protectedlocal.Identifier, error) {
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		return protectedlocal.Identifier{}, err
	}
	defer func() { _ = file.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return protectedlocal.Identifier{}, err
	}
	var result protectedlocal.Identifier
	copy(result[:], hash.Sum(nil))
	return result, nil
}

func localDevelopmentProjectPayloadDigest(root string) (protectedlocal.Identifier, error) {
	canonical := filepath.Clean(root)
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.local-development-payload.v1\x00"))
	files := 0
	var totalBytes int64
	err := filepath.WalkDir(canonical, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == canonical {
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			if _, excluded := localDevelopmentPayloadExcludedDirectories[name]; excluded {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errLocalDevelopmentProjectChanged
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errLocalDevelopmentProjectChanged
		}
		files++
		totalBytes += info.Size()
		if files > localDevelopmentPayloadMaxFiles || totalBytes > localDevelopmentPayloadMaxBytes {
			return errLocalDevelopmentProjectChanged
		}
		relative, err := filepath.Rel(canonical, path)
		if err != nil || strings.HasPrefix(relative, "..") {
			return errLocalDevelopmentProjectChanged
		}
		_, _ = hash.Write([]byte(filepath.ToSlash(relative)))
		_, _ = hash.Write([]byte{0})
		var size [8]byte
		binary.LittleEndian.PutUint64(size[:], uint64(info.Size()))
		_, _ = hash.Write(size[:])
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		after, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if after.Mode()&os.ModeSymlink != 0 {
			return errLocalDevelopmentProjectChanged
		}
		if after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
			return errLocalDevelopmentProjectUnstable
		}
		return nil
	})
	if err != nil {
		return protectedlocal.Identifier{}, err
	}
	if files == 0 {
		return protectedlocal.Identifier{}, errLocalDevelopmentProjectChanged
	}
	var result protectedlocal.Identifier
	copy(result[:], hash.Sum(nil))
	return result, nil
}
