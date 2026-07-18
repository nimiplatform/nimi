package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const realmSourceMaterializationStagingDirectoryV3 = "realm-source-materialization-staging-v3"

type realmSourceMaterializationStagingV3 struct {
	root string
}

type stagedRealmSourceMaterializationPacketV3 struct {
	file         *os.File
	attemptDir   string
	partitionDir string
}

func newRealmSourceMaterializationStagingV3(databasePath string) (*realmSourceMaterializationStagingV3, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" || !filepath.IsAbs(databasePath) {
		return nil, fmt.Errorf("Realm source materialization staging requires an absolute data-root path")
	}
	root := filepath.Join(filepath.Dir(databasePath), realmSourceMaterializationStagingDirectoryV3)
	if err := ensureRealmSourceMaterializationPrivateDirectoryV3(root); err != nil {
		return nil, fmt.Errorf("create Realm source materialization staging root: %w", err)
	}
	return &realmSourceMaterializationStagingV3{root: root}, nil
}

// recoverStartup removes every unfinished private transport byte. The staging
// root contains no product state and is never migrated or interpreted.
func (s *realmSourceMaterializationStagingV3) recoverStartup() error {
	if s == nil || s.root == "" {
		return fmt.Errorf("Realm source materialization staging is unavailable")
	}
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return fmt.Errorf("inventory Realm source materialization staging: %w", err)
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(s.root, entry.Name())); err != nil {
			return fmt.Errorf("clear unfinished Realm source materialization staging: %w", err)
		}
	}
	return nil
}

func (s *realmSourceMaterializationStagingV3) stagePacket(
	ctx context.Context,
	accountID string,
	requestID string,
	body io.Reader,
	maxBytes int64,
	expectedContentLength int64,
) (*stagedRealmSourceMaterializationPacketV3, error) {
	if s == nil || s.root == "" || body == nil || maxBytes <= 0 {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "private Packet staging is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	partitionSum := sha256.Sum256([]byte(accountID + "\x00" + requestID))
	partitionDir := filepath.Join(s.root, hex.EncodeToString(partitionSum[:]))
	if err := ensureRealmSourceMaterializationPrivateDirectoryV3(partitionDir); err != nil {
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "create private Packet partition: %v", err)
	}
	attemptDir, err := createRealmSourceMaterializationPrivateTempDirectoryV3(partitionDir, "attempt-")
	if err != nil {
		_ = os.Remove(partitionDir)
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "create private Packet attempt: %v", err)
	}
	packetPath := filepath.Join(attemptDir, "transport")
	file, err := openRealmSourceMaterializationPrivateFileV3(packetPath)
	if err != nil {
		_ = os.RemoveAll(attemptDir)
		_ = os.Remove(partitionDir)
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "open private Packet staging file: %v", err)
	}
	staged := &stagedRealmSourceMaterializationPacketV3{file: file, attemptDir: attemptDir, partitionDir: partitionDir}
	limited := &io.LimitedReader{R: body, N: maxBytes + 1}
	buffer := make([]byte, 64*1024)
	var written int64
	for {
		if err := ctx.Err(); err != nil {
			_ = staged.cleanup()
			return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "stage private Packet: %v", err)
		}
		count, readErr := limited.Read(buffer)
		if count > 0 {
			written += int64(count)
			if written > maxBytes {
				_ = staged.cleanup()
				return nil, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "Realm Packet exceeds the derived wire budget")
			}
			if _, err := file.Write(buffer[:count]); err != nil {
				_ = staged.cleanup()
				return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "write private Packet staging: %v", err)
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			_ = staged.cleanup()
			return nil, sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "read Realm Packet transport: %v", readErr)
		}
		if count == 0 {
			_ = staged.cleanup()
			return nil, sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "Realm Packet transport ended without progress")
		}
	}
	if written == 0 {
		_ = staged.cleanup()
		return nil, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "Realm Packet transport is empty")
	}
	if expectedContentLength >= 0 && written != expectedContentLength {
		_ = staged.cleanup()
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "Realm Packet transport ended before its declared Content-Length")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		_ = staged.cleanup()
		return nil, sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "rewind private Packet staging: %v", err)
	}
	return staged, nil
}

func (s *stagedRealmSourceMaterializationPacketV3) reader() io.ReadSeeker {
	if s == nil {
		return nil
	}
	return s.file
}

func (s *stagedRealmSourceMaterializationPacketV3) cleanup() error {
	if s == nil {
		return nil
	}
	var cleanupErrors []error
	if s.file != nil {
		cleanupErrors = append(cleanupErrors, s.file.Close())
		s.file = nil
	}
	if s.attemptDir != "" {
		cleanupErrors = append(cleanupErrors, os.RemoveAll(s.attemptDir))
	}
	if s.partitionDir != "" {
		if err := os.Remove(s.partitionDir); err != nil && !errors.Is(err, os.ErrNotExist) {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	if s.attemptDir != "" {
		if _, err := os.Stat(s.attemptDir); !errors.Is(err, os.ErrNotExist) {
			if err == nil {
				cleanupErrors = append(cleanupErrors, fmt.Errorf("private Packet staging residue remains"))
			} else {
				cleanupErrors = append(cleanupErrors, err)
			}
		}
	}
	return errors.Join(cleanupErrors...)
}
