package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("repair-local-agent-chat", flag.ContinueOnError)
	flags.SetOutput(stderr)
	var options repairOptions
	var runtimeStopped bool
	var installerPreinstall bool
	var jsonOutput bool
	flags.StringVar(&options.DBPath, "db", "", "explicit path to the stopped Runtime SQLite database")
	flags.StringVar(&options.BackupPath, "backup", "", "optional explicit backup path (apply mode only)")
	flags.BoolVar(&options.Apply, "apply", false, "apply the repair; default is read-only dry-run")
	flags.BoolVar(
		&installerPreinstall,
		"installer-preinstall",
		false,
		"allow an uninitialized public-chat state to be reported as not-applicable (requires --apply)",
	)
	flags.BoolVar(&jsonOutput, "json", false, "write one structured JSON result")
	flags.BoolVar(
		&runtimeStopped,
		"confirm-runtime-stopped",
		false,
		"required confirmation that the Runtime service is stopped",
	)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if strings.TrimSpace(options.DBPath) == "" {
		_, _ = fmt.Fprintln(stderr, "repair-local-agent-chat: explicit --db path is required")
		return 2
	}
	if !runtimeStopped {
		_, _ = fmt.Fprintln(stderr, "repair-local-agent-chat: --confirm-runtime-stopped is required")
		return 2
	}
	if strings.TrimSpace(options.BackupPath) != "" && !options.Apply {
		_, _ = fmt.Fprintln(stderr, "repair-local-agent-chat: --backup is only valid with --apply")
		return 2
	}
	if installerPreinstall && !options.Apply {
		_, _ = fmt.Fprintln(stderr, "repair-local-agent-chat: --installer-preinstall requires --apply")
		return 2
	}
	options.AllowUninitialized = installerPreinstall
	result, err := repairDatabase(context.Background(), options)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "repair-local-agent-chat: %v\n", err)
		return 1
	}
	mode := "dry-run"
	if !result.Applicable {
		mode = "not-applicable"
	}
	if options.Apply {
		mode = "no-change"
		if !result.Applicable {
			mode = "not-applicable"
		}
		if result.Applied {
			mode = "applied"
		}
	}
	if jsonOutput {
		payload := struct {
			SchemaVersion       int    `json:"schemaVersion"`
			Status              string `json:"status"`
			SkipReason          string `json:"skipReason,omitempty"`
			DuplicateGroups     int    `json:"duplicateGroups"`
			ReactivatedAnchors  int    `json:"reactivatedAnchors"`
			OriginalVersion     uint64 `json:"originalVersion"`
			RepairedVersion     uint64 `json:"repairedVersion"`
			RewrittenAnchorRefs int    `json:"rewrittenAnchorRefs"`
			RewrittenTargetRefs int    `json:"rewrittenTargetRefs"`
			RewrittenFollowUps  int    `json:"rewrittenFollowUpRefs"`
			RewrittenAvatarRefs int    `json:"rewrittenAvatarRefs"`
			BackupPath          string `json:"backupPath,omitempty"`
		}{
			SchemaVersion:       1,
			Status:              mode,
			SkipReason:          result.SkipReason,
			DuplicateGroups:     len(result.DuplicateGroups),
			ReactivatedAnchors:  len(result.ReactivatedAnchorIDs),
			OriginalVersion:     result.OriginalVersion,
			RepairedVersion:     result.RepairedVersion,
			RewrittenAnchorRefs: result.RewrittenAnchorRefs,
			RewrittenTargetRefs: result.RewrittenTargetRefs,
			RewrittenFollowUps:  result.RewrittenFollowUpRefs,
			RewrittenAvatarRefs: result.RewrittenAvatarRefs,
			BackupPath:          result.BackupPath,
		}
		raw, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			_, _ = fmt.Fprintf(stderr, "repair-local-agent-chat: encode JSON result: %v\n", marshalErr)
			return 1
		}
		_, _ = fmt.Fprintln(stdout, string(raw))
		return 0
	}
	if !result.Applicable {
		_, _ = fmt.Fprintf(stdout, "%s: reason=%s\n", mode, result.SkipReason)
		return 0
	}
	_, _ = fmt.Fprintf(
		stdout,
		"%s: duplicate_groups=%d reactivated_anchors=%d anchor_refs=%d target_refs=%d version=%d->%d followup_refs=%d avatar_refs=%d\n",
		mode,
		len(result.DuplicateGroups),
		len(result.ReactivatedAnchorIDs),
		result.RewrittenAnchorRefs,
		result.RewrittenTargetRefs,
		result.OriginalVersion,
		result.RepairedVersion,
		result.RewrittenFollowUpRefs,
		result.RewrittenAvatarRefs,
	)
	for _, group := range result.DuplicateGroups {
		_, _ = fmt.Fprintf(
			stdout,
			"owner_user_id=%q local_agent_ref=%q canonical=%q removed=%q merged_turns=%d\n",
			group.OwnerUserID,
			group.LocalAgentRef,
			group.CanonicalAnchorID,
			strings.Join(group.RemovedAnchorIDs, ","),
			group.MergedTurnCount,
		)
	}
	for _, anchorID := range result.ReactivatedAnchorIDs {
		_, _ = fmt.Fprintf(stdout, "reactivated_anchor=%q\n", anchorID)
	}
	if result.BackupPath != "" {
		_, _ = fmt.Fprintf(stdout, "backup=%s\n", result.BackupPath)
	}
	return 0
}
