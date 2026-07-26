//go:build windows && nimi_runtime_e2e

package entrypoint

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

const (
	windowsE2EAccountID          = "nimi-e2e-account"
	windowsE2ERealmEnvironmentID = "nimi-e2e"
)

func loadWindowsProtectedRuntimeConfig(stateRoot string) (config.Config, error) {
	runtimeRoot := filepath.Join(stateRoot, "runtime")
	cfg := config.Config{
		GRPCAddr:        windowsE2EGRPCAddress,
		HTTPAddr:        windowsE2EHTTPAddress,
		ShutdownTimeout: 10 * time.Second,
		LocalStatePath:  filepath.Join(runtimeRoot, "local-state.json"),
		RuntimeID:       windowsE2ERuntimeID,
		LocalService: config.LocalServiceConfig{
			Enabled: true,
			Mode:    config.LocalServiceModeDesktopLocal,
		},
		SessionTTLMinSeconds:                 60,
		SessionTTLMaxSeconds:                 86_400,
		AIHealthIntervalSeconds:              8,
		AIHTTPTimeoutSeconds:                 30,
		GlobalConcurrencyLimit:               8,
		PerAppConcurrencyLimit:               2,
		IdempotencyCapacity:                  10_000,
		MaxDelegationDepth:                   3,
		AuditRingBufferSize:                  20_000,
		UsageStatsBufferSize:                 50_000,
		LocalAuditCapacity:                   5_000,
		LogLevel:                             "info",
		Providers:                            map[string]config.RuntimeFileTarget{},
		SchedulingDiskDenialThresholdBytes:   500 * 1024 * 1024,
		SchedulingSlowdownRAMThresholdBytes:  2 * 1024 * 1024 * 1024,
		SchedulingSlowdownVRAMThresholdBytes: 1 * 1024 * 1024 * 1024,
		SchedulingSlowdownDiskThresholdBytes: 2 * 1024 * 1024 * 1024,
		SchedulingPreemptionOccupancyPercent: 75,
	}
	if err := cfg.Validate(); err != nil {
		return config.Config{}, fmt.Errorf("validate fixed Windows E2E Runtime config: %w", err)
	}
	return cfg, nil
}

func prepareWindowsRuntimeFixture(ctx context.Context, state *protectedlocal.WindowsRuntimeSecurityState, _ config.Config) error {
	if state == nil || !protectedlocal.WindowsRuntimeIsNonProductFixture() {
		return fmt.Errorf("Windows E2E Runtime requires the fixed non-product security profile")
	}
	partition := state.DesktopIdentity().AccountPartition()
	custody, err := accountservice.NewProtectedBinaryCustody(state.BinarySecrets())
	if err != nil {
		return fmt.Errorf("open Windows E2E account custody: %w", err)
	}
	now := time.Now().UTC()
	current, err := custody.Load(ctx, partition)
	if err == nil {
		if current.AccountID != windowsE2EAccountID ||
			current.RealmEnvironmentID != windowsE2ERealmEnvironmentID {
			return fmt.Errorf("Windows E2E custody contains a non-fixture account")
		}
		if current.AccessTokenExpires.After(now.Add(10 * time.Minute)) {
			return nil
		}
	} else if !errors.Is(err, accountservice.ErrNoStoredAccount) {
		return fmt.Errorf("load Windows E2E account custody: %w", err)
	}
	accessToken, err := randomWindowsE2ECredential()
	if err != nil {
		return err
	}
	refreshToken, err := randomWindowsE2ECredential()
	if err != nil {
		return err
	}
	material := accountservice.AccountMaterial{
		AccountID:            windowsE2EAccountID,
		DisplayName:          "Nimi E2E 开发账号",
		RealmEnvironmentID:   windowsE2ERealmEnvironmentID,
		AccessToken:          accessToken,
		AccessTokenExpires:   now.Add(12 * time.Hour),
		RefreshToken:         refreshToken,
		RefreshTokenHashes:   map[string]bool{},
		WorkspaceMemberships: nil,
	}
	if err := custody.Store(ctx, partition, material); err != nil {
		return fmt.Errorf("store Windows E2E account custody: %w", err)
	}
	return nil
}

func randomWindowsE2ECredential() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate Windows E2E account material: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
