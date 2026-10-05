package localservice

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestGitHubCommitSourceRejectsMutableAndEscapingLocators(t *testing.T) {
	commit := strings.Repeat("a", 40)
	got, err := buildGitHubCommitFileURL("spotify/basic-pitch", commit, "basic_pitch/saved_models/nmp.onnx")
	if err != nil || got != "https://raw.githubusercontent.com/spotify/basic-pitch/"+commit+"/basic_pitch/saved_models/nmp.onnx" {
		t.Fatal(got, err)
	}
	for _, input := range [][3]string{{"spotify/basic-pitch", "main", "model.onnx"}, {"https://github.com/spotify/basic-pitch", commit, "model.onnx"}, {"spotify/basic-pitch", commit, "../model.onnx"}, {"spotify/basic-pitch", commit, "/model.onnx"}} {
		if _, err := buildGitHubCommitFileURL(input[0], input[1], input[2]); err == nil {
			t.Fatalf("unsafe source accepted: %v", input)
		}
	}
	for _, target := range []string{"http://raw.githubusercontent.com/file", "https://other.example/file", "https://raw.githubusercontent.com:443/file"} {
		u, _ := url.Parse(target)
		if gitHubCommitFileRedirect(&http.Request{URL: u}, nil) == nil {
			t.Fatal("unadmitted redirect accepted", target)
		}
	}
}
