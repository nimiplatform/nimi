function buildRunScript() {
  return [
    'param(',
    '  [string]$CodexBin = "codex",',
    '  [string]$Model = ""',
    ')',
    '$ErrorActionPreference = "Stop"',
    '$Root = Split-Path -Parent $PSCommandPath',
    '$Request = Join-Path $Root "provider-request.yaml"',
    '$Prompt = Join-Path $Root "prompt.md"',
    '$Schema = Join-Path $Root "codex-image2-output.schema.json"',
    '$Response = Join-Path $Root "codex-response.json"',
    '$RequestYaml = Get-Content -Raw (Join-Path $Root "provider-request.yaml")',
    '$Cwd = $Root',
    '$SourceImageRef = if ($RequestYaml -match "source_image_ref: (.+)") { $Matches[1].Trim() } else { "" }',
    '$Args = @("exec", "--cd", $Cwd, "--output-schema", $Schema, "-o", $Response)',
    'if ($Model.Length -gt 0) { $Args = @("exec", "-m", $Model, "--cd", $Cwd, "--output-schema", $Schema, "-o", $Response) }',
    'if ($SourceImageRef.Length -gt 0 -and $SourceImageRef -ne "null") { $Args += @("-i", (Join-Path $Root $SourceImageRef)) }',
    '$Args += "-"',
    'Get-Content -Raw $Prompt | & $CodexBin @Args',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'Write-Output "Codex Image2 response written to $Response for request $Request"',
    '',
  ].join('\n');
}

export { buildRunScript };
