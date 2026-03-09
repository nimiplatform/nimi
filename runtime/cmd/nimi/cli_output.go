package main

import (
	"fmt"
	"io"
	"strings"
)

func printCLIHeader(w io.Writer, title string) {
	fmt.Fprintln(w, strings.TrimSpace(title))
	fmt.Fprintln(w)
}

func printCLIField(w io.Writer, label string, value string) {
	label = strings.TrimSpace(label)
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	if label == "" {
		fmt.Fprintf(w, "  %s\n", value)
		return
	}
	fmt.Fprintf(w, "  %-14s %s\n", label+":", value)
}

func printCLINextStep(w io.Writer, command string) {
	command = strings.TrimSpace(command)
	if command == "" {
		return
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Next")
	fmt.Fprintln(w)
	printCLIField(w, "", command)
}

func inlineStatusLabel(status string) string {
	normalized := strings.ToLower(strings.TrimSpace(status))
	switch normalized {
	case "":
		return ""
	case "ok":
		return "[ok]"
	case "warn", "warning":
		return "[warn]"
	case "error", "fail", "failed":
		return "[error]"
	default:
		return "[" + normalized + "]"
	}
}
