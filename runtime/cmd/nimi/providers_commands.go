package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/entrypoint"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"
)

func runRuntimeProviders(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi providers", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	httpAddr := fs.String("http-addr", cfg.HTTPAddr, "runtime HTTP address")
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	source := fs.String("source", providerSourceHTTP, "provider snapshot source: http|grpc")
	timeoutRaw := fs.String("timeout", "3s", "request timeout")
	jsonOutput := fs.Bool("json", false, "output json")
	watch := fs.Bool("watch", false, "watch provider snapshots continuously")
	changesOnly := fs.Bool("changes-only", true, "print only when provider states change (used with --watch)")
	intervalRaw := fs.String("interval", "5s", "watch interval (used with --watch)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	sourceValue := strings.ToLower(strings.TrimSpace(*source))

	if !*watch {
		providers, sampledAt, err := fetchProviderSnapshots(sourceValue, *httpAddr, *grpcAddr, timeout)
		if err != nil {
			return err
		}
		return printProviderSnapshot(providers, sampledAt, *jsonOutput)
	}

	if sourceValue == providerSourceGRPC {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return watchProviderSnapshotsGRPC(ctx, *grpcAddr, *jsonOutput, *changesOnly)
	}
	if sourceValue != providerSourceHTTP {
		return fmt.Errorf("invalid source %q (expected http|grpc)", sourceValue)
	}

	interval, err := time.ParseDuration(*intervalRaw)
	if err != nil {
		return fmt.Errorf("parse interval: %w", err)
	}
	if interval <= 0 {
		return fmt.Errorf("parse interval: interval must be > 0")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	lastSignature := ""
	hasBaseline := false
	var lastProviders []providerSnapshot

	for {
		providers, sampledAt, err := fetchProviderSnapshots(sourceValue, *httpAddr, *grpcAddr, timeout)
		if err != nil {
			return err
		}
		signature := providersSignature(providers)
		if !hasBaseline {
			if err := printProviderSnapshot(providers, sampledAt, *jsonOutput); err != nil {
				return err
			}
			lastSignature = signature
			lastProviders = cloneProviderSnapshots(providers)
			hasBaseline = true
		} else if !*changesOnly {
			if err := printProviderSnapshot(providers, sampledAt, *jsonOutput); err != nil {
				return err
			}
			lastSignature = signature
			lastProviders = cloneProviderSnapshots(providers)
		} else if signature != lastSignature {
			changes := buildProviderDiff(lastProviders, providers)
			if err := printProviderChanges(changes, sampledAt, *jsonOutput); err != nil {
				return err
			}
			lastSignature = signature
			lastProviders = cloneProviderSnapshots(providers)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func watchProviderSnapshotsGRPC(ctx context.Context, grpcAddr string, jsonOutput bool, changesOnly bool) error {
	events, errCh, err := entrypoint.SubscribeAIProviderHealthGRPC(ctx, grpcAddr)
	if err != nil {
		return err
	}

	current := make(map[string]providerSnapshot)
	for {
		select {
		case <-ctx.Done():
			return nil
		case streamErr, ok := <-errCh:
			if !ok {
				errCh = nil
				if events == nil {
					return nil
				}
				continue
			}
			if streamErr != nil {
				return streamErr
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				if errCh == nil {
					return nil
				}
				continue
			}
			sampledAt := time.Now().UTC().Format(time.RFC3339Nano)
			next := providerSnapshot{
				Name:                event.Snapshot.Name,
				State:               event.Snapshot.State,
				Reason:              event.Snapshot.Reason,
				ConsecutiveFailures: int64(event.Snapshot.ConsecutiveFailures),
				LastChangedAt:       event.Snapshot.LastChangedAt,
				LastCheckedAt:       event.Snapshot.LastCheckedAt,
			}

			before, exists := current[next.Name]
			current[next.Name] = next

			if !changesOnly {
				if err := printProviderSnapshot(providerMapToSlice(current), sampledAt, jsonOutput); err != nil {
					return err
				}
				continue
			}

			var changes []providerChange
			if !exists {
				afterCopy := next
				changes = []providerChange{{
					Name:  next.Name,
					Type:  "added",
					After: &afterCopy,
				}}
			} else if providerChanged(before, next) {
				beforeCopy := before
				afterCopy := next
				changes = []providerChange{{
					Name:   next.Name,
					Type:   "updated",
					Before: &beforeCopy,
					After:  &afterCopy,
				}}
			}
			if len(changes) == 0 {
				continue
			}
			if err := printProviderChanges(changes, sampledAt, jsonOutput); err != nil {
				return err
			}
		}
	}
}

func fetchProviderSnapshots(source string, httpAddr string, grpcAddr string, timeout time.Duration) ([]providerSnapshot, string, error) {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case providerSourceHTTP:
		payload, err := entrypoint.FetchHealth(httpAddr, timeout)
		if err != nil {
			return nil, "", err
		}
		sampledAt := getString(payload["sampled_at"])
		if sampledAt == "" {
			sampledAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		return extractProviders(payload), sampledAt, nil
	case providerSourceGRPC:
		items, err := entrypoint.FetchAIProviderHealthGRPC(grpcAddr, timeout)
		if err != nil {
			return nil, "", err
		}
		snapshots := make([]providerSnapshot, 0, len(items))
		for _, item := range items {
			snapshots = append(snapshots, providerSnapshot{
				Name:                item.Name,
				State:               item.State,
				Reason:              item.Reason,
				ConsecutiveFailures: int64(item.ConsecutiveFailures),
				LastChangedAt:       item.LastChangedAt,
				LastCheckedAt:       item.LastCheckedAt,
			})
		}
		return snapshots, time.Now().UTC().Format(time.RFC3339Nano), nil
	default:
		return nil, "", fmt.Errorf("invalid source %q (expected http|grpc)", source)
	}
}

func printProviderSnapshot(providers []providerSnapshot, sampledAt string, jsonOutput bool) error {
	if strings.TrimSpace(sampledAt) == "" {
		sampledAt = time.Now().UTC().Format(time.RFC3339Nano)
	}

	sort.Slice(providers, func(i, j int) bool {
		return providers[i].Name < providers[j].Name
	})

	if jsonOutput {
		out, err := json.MarshalIndent(map[string]any{
			"sampled_at": sampledAt,
			"providers":  providers,
		}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Printf("[%s]\n", sampledAt)
	if len(providers) == 0 {
		fmt.Println("no provider health snapshots")
		fmt.Println()
		return nil
	}

	fmt.Printf("%-18s %-10s %-9s %-30s %s\n", "NAME", "STATE", "FAILURES", "LAST_CHECKED_AT", "REASON")
	for _, item := range providers {
		fmt.Printf("%-18s %-10s %-9d %-30s %s\n",
			item.Name,
			item.State,
			item.ConsecutiveFailures,
			item.LastCheckedAt,
			item.Reason,
		)
	}
	fmt.Println()
	return nil
}
