package main

import (
	"context"
	"io"
	"os"
	"strings"

	"google.golang.org/grpc/metadata"
)

func captureStdoutFromRun(run func() error) (string, error) {
	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		return "", err
	}
	defer func() { _ = reader.Close() }()
	os.Stdout = writer

	outputCh := make(chan string, 1)
	go func() {
		data, _ := io.ReadAll(reader)
		outputCh <- string(data)
	}()

	runErr := run()
	_ = writer.Close()
	os.Stdout = original
	output := <-outputCh
	return strings.TrimSpace(output), runErr
}

func cloneIncomingMetadata(ctx context.Context) metadata.MD {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return metadata.MD{}
	}
	return md.Copy()
}

func firstMD(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func asString(value any) string {
	item, _ := value.(string)
	return item
}

func asFloat(value any) float64 {
	switch item := value.(type) {
	case float64:
		return item
	case float32:
		return float64(item)
	default:
		return 0
	}
}

func splitNonEmptyLines(input string) []string {
	parts := strings.Split(strings.TrimSpace(input), "\n")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
