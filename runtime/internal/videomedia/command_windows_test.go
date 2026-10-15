package videomedia

import (
	"context"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestCodecCommandRunsWithoutConsole(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := newCodecCommand(ctx, os.Args[0], "-test.run=^TestCodecCommandChildWithoutConsole$")
	command.Env = append(os.Environ(), "NIMI_CODEC_NO_CONSOLE_TEST_CHILD=1")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("codec child must execute without allocating a console: %v (%s)", err, output)
	}
}

func TestCodecCommandChildWithoutConsole(t *testing.T) {
	if os.Getenv("NIMI_CODEC_NO_CONSOLE_TEST_CHILD") != "1" {
		return
	}
	console, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
	if console != 0 {
		t.Fatal("codec child has a console window")
	}
}
