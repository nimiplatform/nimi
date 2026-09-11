package nimiappinstall

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

var ErrAppInfoUnavailable = errors.New("App information is unavailable")

type appInfoDownloader interface {
	DownloadAppInfo(context.Context, publicappregistry.ResolvedApprovedTarget) ([]byte, error)
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042b
func (downloader *Downloader) DownloadAppInfo(ctx context.Context, resolved publicappregistry.ResolvedApprovedTarget) ([]byte, error) {
	if ctx == nil || downloader == nil || downloader.client == nil {
		return nil, ErrAppInfoUnavailable
	}
	asset := resolved.Target.AppInfo
	if resolved.Selector.DescriptorID() == "" || resolved.Selector.DescriptorID() != resolved.DescriptorID || resolved.Selector.TargetID() != resolved.Target.TargetID || resolved.Selector.ObservedRegistryCommit() != resolved.RegistryRevision || resolved.Visibility != "public" || resolved.KillSwitch.Active || !resolved.Release.Immutable || resolved.Release.Prerelease || asset.AssetID <= 0 || asset.Size <= 0 || asset.Size > nimiapppackage.MaxAppInfoBytes || asset.AssetURL != resolved.Source.Repository+"/releases/download/"+url.PathEscape(resolved.Release.Tag)+"/"+url.PathEscape(asset.AssetName) {
		return nil, ErrInvalidDownloadTarget
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.AssetURL, nil)
	if err != nil {
		return nil, err
	}
	if request.URL.Scheme != "https" || request.URL.Host != "github.com" || request.URL.User != nil {
		return nil, ErrInvalidDownloadTarget
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("Accept-Encoding", "identity")
	response, err := downloader.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download App info: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK || (response.ContentLength >= 0 && response.ContentLength != asset.Size) {
		return nil, ErrAppInfoUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, asset.Size+1))
	if err != nil {
		return nil, fmt.Errorf("read App info: %w", err)
	}
	digest := sha256.Sum256(raw)
	if int64(len(raw)) != asset.Size || hex.EncodeToString(digest[:]) != asset.SHA256 {
		return nil, nimiapppackage.ErrPackageIntegrity
	}
	return raw, nil
}

func (coordinator *Coordinator) ReadApprovedAppInfo(ctx context.Context, selector publicappregistry.ApprovedTargetSelector) (nimiapppackage.AppInfo, error) {
	if coordinator == nil || coordinator.registry == nil {
		return nimiapppackage.AppInfo{}, ErrAppInfoUnavailable
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	downloader, ok := coordinator.downloader.(appInfoDownloader)
	if !ok {
		return nimiapppackage.AppInfo{}, ErrAppInfoUnavailable
	}
	resolved, err := coordinator.registry.Revalidate(ctx, selector)
	if err != nil {
		return nimiapppackage.AppInfo{}, err
	}
	raw, err := downloader.DownloadAppInfo(ctx, resolved)
	if err != nil {
		return nimiapppackage.AppInfo{}, err
	}
	info, err := nimiapppackage.ParseAppInfo(raw)
	if err != nil {
		return nimiapppackage.AppInfo{}, err
	}
	if err := nimiapppackage.ValidateAppInfoSelection(info, raw, packageExpectation(resolved)); err != nil {
		return nimiapppackage.AppInfo{}, err
	}
	return info, nil
}
