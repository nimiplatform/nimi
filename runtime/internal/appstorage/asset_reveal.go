package appstorage

import (
	"context"
	"errors"
	"os"
)

// Finder view state is installed once during fixed-service startup, before
// requests are admitted. Other topologies have no cross-user publication.
type AssetRevealViews interface {
	publish(session string, uid uint32, dataRoot string, file *os.File) (string, error)
	Release(session string) error
	invalidate(path string) error
	Close() error
}

func (s *AssetStore) SetRevealViews(views AssetRevealViews) { s.revealViews = views }

func (s *AssetStore) invalidateReveal(paths ...string) error {
	if s.revealViews != nil {
		for _, path := range paths {
			if err := s.revealViews.invalidate(path); err != nil {
				return errors.Join(ErrAssetUnavailable, err)
			}
		}
	}
	return nil
}

// PublishVerifiedReveal keeps the verified descriptor and the asset's mutation
// lock until the caller's account/registration/session commit fence finishes.
func (s *AssetStore) PublishVerifiedReveal(ctx context.Context, owner ManagedOwner, relativePath string, session string, uid uint32, guard func(func() error) error) (AssetRecord, string, error) {
	if s.revealViews == nil || guard == nil || session == "" || uid == 0 {
		return AssetRecord{}, "", ErrAssetUnavailable
	}
	key, err := NormalizeAssetRelativePath(relativePath)
	if err != nil {
		return AssetRecord{}, "", err
	}
	unlock := s.lockAssetPaths(managedOwnerKey(owner), key)
	defer unlock()
	record, body, err := s.openAsset(ctx, owner, key)
	if err != nil {
		return AssetRecord{}, "", err
	}
	defer func() { _ = body.Close() }()
	var target string
	err = guard(func() error {
		var publishErr error
		target, publishErr = s.revealViews.publish(session, uid, s.dataRoot, body.file)
		return publishErr
	})
	if err != nil {
		return AssetRecord{}, "", err
	}
	return record, target, nil
}
