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
	"strconv"
	"strings"
	"syscall"
	"time"
)

func runRuntimeHealth(args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	fs := flag.NewFlagSet("nimi health", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	source := fs.String("source", providerSourceHTTP, "health source: http|grpc")
	httpAddr := fs.String("http-addr", cfg.HTTPAddr, "runtime HTTP address")
	grpcAddr := fs.String("grpc-addr", cfg.GRPCAddr, "runtime gRPC address")
	timeoutRaw := fs.String("timeout", "3s", "request timeout")
	watch := fs.Bool("watch", false, "watch runtime health continuously")
	changesOnly := fs.Bool("changes-only", true, "print only health field changes (used with --watch)")
	intervalRaw := fs.String("interval", "5s", "watch interval (used with --watch and source=http)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	timeout, err := time.ParseDuration(*timeoutRaw)
	if err != nil {
		return fmt.Errorf("parse timeout: %w", err)
	}
	sourceValue := strings.ToLower(strings.TrimSpace(*source))

	if !*watch {
		payload, err := fetchRuntimeHealthPayload(sourceValue, *httpAddr, *grpcAddr, timeout)
		if err != nil {
			return err
		}
		output, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(output))
		return nil
	}

	if sourceValue == providerSourceGRPC {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return watchRuntimeHealthGRPC(ctx, *grpcAddr, *changesOnly)
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
	var lastSnapshot runtimeHealthSnapshot

	for {
		snapshot, err := fetchRuntimeHealthSnapshot(sourceValue, *httpAddr, *grpcAddr, timeout)
		if err != nil {
			return err
		}
		signature := runtimeHealthSignature(snapshot)
		if !hasBaseline {
			printRuntimeHealthSnapshot(snapshot)
			lastSignature = signature
			lastSnapshot = snapshot
			hasBaseline = true
		} else if !*changesOnly {
			printRuntimeHealthSnapshot(snapshot)
			lastSignature = signature
			lastSnapshot = snapshot
		} else if signature != lastSignature {
			changes := buildRuntimeHealthChanges(lastSnapshot, snapshot)
			printRuntimeHealthChanges(snapshot.SampledAt, changes)
			lastSignature = signature
			lastSnapshot = snapshot
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func fetchRuntimeHealthPayload(source string, httpAddr string, grpcAddr string, timeout time.Duration) (map[string]any, error) {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case providerSourceHTTP:
		return entrypoint.FetchHealth(httpAddr, timeout)
	case providerSourceGRPC:
		return entrypoint.FetchRuntimeHealthGRPC(grpcAddr, timeout)
	default:
		return nil, fmt.Errorf("invalid source %q (expected http|grpc)", source)
	}
}

func fetchRuntimeHealthSnapshot(source string, httpAddr string, grpcAddr string, timeout time.Duration) (runtimeHealthSnapshot, error) {
	payload, err := fetchRuntimeHealthPayload(source, httpAddr, grpcAddr, timeout)
	if err != nil {
		return runtimeHealthSnapshot{}, err
	}
	return extractRuntimeHealthSnapshot(payload), nil
}

func extractRuntimeHealthSnapshot(payload map[string]any) runtimeHealthSnapshot {
	sampledAt := getString(payload["sampled_at"])
	if sampledAt == "" {
		sampledAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return runtimeHealthSnapshot{
		Status:              getString(payload["status"]),
		StatusCode:          int32(getInt64(payload["status_code"])),
		Reason:              getString(payload["reason"]),
		QueueDepth:          int32(getInt64(payload["queue_depth"])),
		ActiveWorkflows:     int32(getInt64(payload["active_workflows"])),
		ActiveInferenceJobs: int32(getInt64(payload["active_inference_jobs"])),
		CPUMilli:            getInt64(payload["cpu_milli"]),
		MemoryBytes:         getInt64(payload["memory_bytes"]),
		VRAMBytes:           getInt64(payload["vram_bytes"]),
		SampledAt:           sampledAt,
	}
}

func watchRuntimeHealthGRPC(ctx context.Context, grpcAddr string, changesOnly bool) error {
	events, errCh, err := entrypoint.SubscribeRuntimeHealthGRPC(ctx, grpcAddr)
	if err != nil {
		return err
	}

	var lastSnapshot runtimeHealthSnapshot
	hasBaseline := false
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
			snapshot := runtimeHealthSnapshot{
				Status:              event.Snapshot.Status,
				StatusCode:          event.Snapshot.StatusCode,
				Reason:              event.Snapshot.Reason,
				QueueDepth:          event.Snapshot.QueueDepth,
				ActiveWorkflows:     event.Snapshot.ActiveWorkflows,
				ActiveInferenceJobs: event.Snapshot.ActiveInferenceJobs,
				CPUMilli:            event.Snapshot.CPUMilli,
				MemoryBytes:         event.Snapshot.MemoryBytes,
				VRAMBytes:           event.Snapshot.VRAMBytes,
				SampledAt:           event.Snapshot.SampledAt,
			}
			if strings.TrimSpace(snapshot.SampledAt) == "" {
				snapshot.SampledAt = time.Now().UTC().Format(time.RFC3339Nano)
			}

			if !hasBaseline {
				printRuntimeHealthSnapshot(snapshot)
				lastSnapshot = snapshot
				hasBaseline = true
				continue
			}
			if !changesOnly {
				printRuntimeHealthSnapshot(snapshot)
				lastSnapshot = snapshot
				continue
			}
			changes := buildRuntimeHealthChanges(lastSnapshot, snapshot)
			if len(changes) == 0 {
				continue
			}
			printRuntimeHealthChanges(snapshot.SampledAt, changes)
			lastSnapshot = snapshot
		}
	}
}

func runtimeHealthSignature(snapshot runtimeHealthSnapshot) string {
	return strings.Join([]string{
		snapshot.Status,
		strconv.FormatInt(int64(snapshot.StatusCode), 10),
		snapshot.Reason,
		strconv.FormatInt(int64(snapshot.QueueDepth), 10),
		strconv.FormatInt(int64(snapshot.ActiveWorkflows), 10),
		strconv.FormatInt(int64(snapshot.ActiveInferenceJobs), 10),
		strconv.FormatInt(snapshot.CPUMilli, 10),
		strconv.FormatInt(snapshot.MemoryBytes, 10),
		strconv.FormatInt(snapshot.VRAMBytes, 10),
	}, "|")
}

func buildRuntimeHealthChanges(before runtimeHealthSnapshot, after runtimeHealthSnapshot) []runtimeHealthChange {
	out := make([]runtimeHealthChange, 0, 9)
	appendIfChanged := func(field string, left string, right string) {
		if left == right {
			return
		}
		out = append(out, runtimeHealthChange{
			Field:  field,
			Before: left,
			After:  right,
		})
	}
	appendIfChanged("status", before.Status, after.Status)
	appendIfChanged("status_code", strconv.FormatInt(int64(before.StatusCode), 10), strconv.FormatInt(int64(after.StatusCode), 10))
	appendIfChanged("reason", before.Reason, after.Reason)
	appendIfChanged("queue_depth", strconv.FormatInt(int64(before.QueueDepth), 10), strconv.FormatInt(int64(after.QueueDepth), 10))
	appendIfChanged("active_workflows", strconv.FormatInt(int64(before.ActiveWorkflows), 10), strconv.FormatInt(int64(after.ActiveWorkflows), 10))
	appendIfChanged("active_inference_jobs", strconv.FormatInt(int64(before.ActiveInferenceJobs), 10), strconv.FormatInt(int64(after.ActiveInferenceJobs), 10))
	appendIfChanged("cpu_milli", strconv.FormatInt(before.CPUMilli, 10), strconv.FormatInt(after.CPUMilli, 10))
	appendIfChanged("memory_bytes", strconv.FormatInt(before.MemoryBytes, 10), strconv.FormatInt(after.MemoryBytes, 10))
	appendIfChanged("vram_bytes", strconv.FormatInt(before.VRAMBytes, 10), strconv.FormatInt(after.VRAMBytes, 10))
	return out
}

func printRuntimeHealthSnapshot(snapshot runtimeHealthSnapshot) {
	fmt.Printf("[%s] status=%s reason=%q queue=%d workflows=%d inference=%d cpu_milli=%d memory_bytes=%d vram_bytes=%d\n",
		snapshot.SampledAt,
		snapshot.Status,
		snapshot.Reason,
		snapshot.QueueDepth,
		snapshot.ActiveWorkflows,
		snapshot.ActiveInferenceJobs,
		snapshot.CPUMilli,
		snapshot.MemoryBytes,
		snapshot.VRAMBytes,
	)
}

func printRuntimeHealthChanges(sampledAt string, changes []runtimeHealthChange) {
	if strings.TrimSpace(sampledAt) == "" {
		sampledAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	fmt.Printf("[%s] runtime health changes\n", sampledAt)
	if len(changes) == 0 {
		fmt.Println("no runtime health changes")
		fmt.Println()
		return
	}
	fmt.Printf("%-24s %-16s %s\n", "FIELD", "BEFORE", "AFTER")
	for _, item := range changes {
		fmt.Printf("%-24s %-16s %s\n", item.Field, item.Before, item.After)
	}
	fmt.Println()
}
