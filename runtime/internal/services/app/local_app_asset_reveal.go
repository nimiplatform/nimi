package app

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func (s *Service) resolveNativeAssetReveal(ctx context.Context, store *appstorage.AssetStore, d accountservice.LocalAppCallerDecision, path string) (appstorage.AssetRecord, string, error) {
	if s.finderViews == nil {
		return store.ResolveRevealTarget(ctx, localAppAssetOwner(d), path)
	}
	// Only a verified local macOS connection has an OS principal. Remote
	// requests and caller-selected uid/path values cannot authorize a view.
	conn, ok := protectedlocal.LocalAppConnectionFromContext(ctx)
	if !ok || conn == nil || d.Process.OS != protectedlocal.OSMacOS {
		return appstorage.AssetRecord{}, "", appstorage.ErrAssetUnavailable
	}
	principal := d.Process.SecurityPrincipal
	uid, err := strconv.ParseUint(strings.TrimPrefix(principal, "macos-uid:"), 10, 32)
	if err != nil || uid == 0 || principal != fmt.Sprintf("macos-uid:%d", uid) {
		return appstorage.AssetRecord{}, "", appstorage.ErrAssetUnavailable
	}
	if int(uid) == os.Geteuid() {
		return store.ResolveRevealTarget(ctx, localAppAssetOwner(d), path)
	}
	handle, ok := conn.Session()
	if !ok || handle.SessionID != d.SessionID {
		return appstorage.AssetRecord{}, "", appstorage.ErrAssetUnavailable
	}
	session := hex.EncodeToString(d.SessionID[:])
	const resource = "storage.asset.reveal.finder"
	if !conn.SessionOwnsResource(handle, resource) {
		bound := conn.BindSessionResource(handle, resource, func() {
			if err := s.finderViews.Release(session); err != nil {
				s.logger.Error("revoke Finder asset view", "error", err)
			}
		})
		if !bound && !conn.SessionOwnsResource(handle, resource) {
			return appstorage.AssetRecord{}, "", appstorage.ErrAssetUnavailable
		}
	}
	return store.PublishVerifiedReveal(ctx, localAppAssetOwner(d), path, session, uint32(uid), func(commit func() error) error {
		return s.commitLocalAppStorage(ctx, localappop.IngressStorageAssetReveal, d, commit)
	})
}
