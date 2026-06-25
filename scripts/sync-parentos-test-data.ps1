param(
    [string]$SourceRoot = "D:\nimi_data",
    [string]$TargetRoot = "D:\Nimi",
    [switch]$Execute,
    [switch]$Overwrite,
    [switch]$IncludeCompanionData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-Path {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Test-IsNestedPath {
    param(
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Child
    )

    return $Child.StartsWith($Parent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Format-Bytes {
    param([long]$Bytes)

    if ($Bytes -ge 1GB) {
        return "{0:N2} GB" -f ($Bytes / 1GB)
    }
    if ($Bytes -ge 1MB) {
        return "{0:N2} MB" -f ($Bytes / 1MB)
    }
    if ($Bytes -ge 1KB) {
        return "{0:N2} KB" -f ($Bytes / 1KB)
    }
    return "$Bytes B"
}

function ConvertTo-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $rootFull = Normalize-Path -Path $Root
    $pathFull = Normalize-Path -Path $Path
    if ($pathFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return "."
    }
    if (-not (Test-IsNestedPath -Parent $rootFull -Child $pathFull)) {
        throw "Path is not under root. Root=$rootFull Path=$pathFull"
    }

    return $pathFull.Substring($rootFull.Length + 1)
}

function Add-FilePlan {
    param(
        [System.Collections.Generic.List[object]]$Plan,
        [Parameter(Mandatory = $true)][string]$SourceFile,
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$TargetRoot
    )

    $sourceItem = Get-Item -LiteralPath $SourceFile -Force
    $targetFile = Join-Path $TargetRoot $RelativePath
    $targetExists = Test-Path -LiteralPath $targetFile
    $willCopy = (-not $targetExists) -or $Overwrite.IsPresent

    $Plan.Add([pscustomobject]@{
        Source = $sourceItem.FullName
        Target = $targetFile
        RelativePath = $RelativePath
        Bytes = [long]$sourceItem.Length
        TargetExists = [bool]$targetExists
        WillCopy = [bool]$willCopy
        Reason = if ($willCopy) { "copy" } else { "skip-existing" }
    })
}

function Add-DirectoryPlan {
    param(
        [System.Collections.Generic.List[object]]$Plan,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$DirectoryName,
        [Parameter(Mandatory = $true)][string]$TargetRoot
    )

    $sourceDir = Join-Path $SourceRoot $DirectoryName
    if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
        return
    }

    Get-ChildItem -LiteralPath $sourceDir -Recurse -Force -File | ForEach-Object {
        $relative = ConvertTo-RelativePath -Root $SourceRoot -Path $_.FullName
        Add-FilePlan -Plan $Plan -SourceFile $_.FullName -RelativePath $relative -TargetRoot $TargetRoot
    }
}

function Add-TopLevelPatternPlan {
    param(
        [System.Collections.Generic.List[object]]$Plan,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$TargetRoot
    )

    Get-ChildItem -LiteralPath $SourceRoot -Force -File -Filter $Pattern | ForEach-Object {
        $relative = ConvertTo-RelativePath -Root $SourceRoot -Path $_.FullName
        Add-FilePlan -Plan $Plan -SourceFile $_.FullName -RelativePath $relative -TargetRoot $TargetRoot
    }
}

function Add-RecursiveNamePatternPlan {
    param(
        [System.Collections.Generic.List[object]]$Plan,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$TargetRoot
    )

    Get-ChildItem -LiteralPath $SourceRoot -Recurse -Force -File |
        Where-Object { $_.Name -like $Pattern } |
        ForEach-Object {
            $relative = ConvertTo-RelativePath -Root $SourceRoot -Path $_.FullName
            Add-FilePlan -Plan $Plan -SourceFile $_.FullName -RelativePath $relative -TargetRoot $TargetRoot
        }
}

function Sum-PlanBytes {
    param([object[]]$Items)

    if ($null -eq $Items -or $Items.Count -eq 0) {
        return 0
    }
    $sum = ($Items | Measure-Object -Property Bytes -Sum).Sum
    if ($null -eq $sum) {
        return 0
    }
    return [long]$sum
}

$sourceFull = Normalize-Path -Path $SourceRoot
$targetFull = Normalize-Path -Path $TargetRoot

if (-not (Test-Path -LiteralPath $sourceFull -PathType Container)) {
    throw "Source root does not exist: $sourceFull"
}

if ($sourceFull.Equals($targetFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Source and target must be different paths."
}

if ((Test-IsNestedPath -Parent $sourceFull -Child $targetFull) -or (Test-IsNestedPath -Parent $targetFull -Child $sourceFull)) {
    throw "Refusing to sync nested source/target paths. Source=$sourceFull Target=$targetFull"
}

$plan = [System.Collections.Generic.List[object]]::new()

Add-DirectoryPlan -Plan $plan -SourceRoot $sourceFull -DirectoryName "parentos" -TargetRoot $targetFull
Add-TopLevelPatternPlan -Plan $plan -SourceRoot $sourceFull -Pattern "parentos*.db*" -TargetRoot $targetFull
Add-TopLevelPatternPlan -Plan $plan -SourceRoot $sourceFull -Pattern "parentos*.zip" -TargetRoot $targetFull
Add-RecursiveNamePatternPlan -Plan $plan -SourceRoot $sourceFull -Pattern "*parentos*" -TargetRoot $targetFull

if ($IncludeCompanionData.IsPresent) {
    Add-DirectoryPlan -Plan $plan -SourceRoot $sourceFull -DirectoryName "chat-agent" -TargetRoot $targetFull
    Add-DirectoryPlan -Plan $plan -SourceRoot $sourceFull -DirectoryName "chat-ai" -TargetRoot $targetFull
    Add-TopLevelPatternPlan -Plan $plan -SourceRoot $sourceFull -Pattern "memory.db*" -TargetRoot $targetFull
}

$uniquePlan = $plan |
    Sort-Object -Property Target -Unique |
    Sort-Object -Property RelativePath

$copyPlan = @($uniquePlan | Where-Object { $_.WillCopy })
$skipPlan = @($uniquePlan | Where-Object { -not $_.WillCopy })
$totalBytes = Sum-PlanBytes -Items @($uniquePlan)
$copyBytes = Sum-PlanBytes -Items @($copyPlan)

Write-Host "ParentOS test data sync"
Write-Host "  Source: $sourceFull"
Write-Host "  Target: $targetFull"
Write-Host "  Mode:   $(if ($Execute.IsPresent) { 'execute' } else { 'dry-run' })"
Write-Host "  Overwrite existing target files: $($Overwrite.IsPresent)"
Write-Host "  Include companion chat/memory data: $($IncludeCompanionData.IsPresent)"
Write-Host ""
Write-Host "Plan:"
Write-Host "  Candidate files: $($uniquePlan.Count) ($(Format-Bytes -Bytes $totalBytes))"
Write-Host "  Will copy:       $($copyPlan.Count) ($(Format-Bytes -Bytes $copyBytes))"
Write-Host "  Skip existing:   $($skipPlan.Count)"

if ($uniquePlan.Count -eq 0) {
    Write-Host ""
    Write-Host "No ParentOS test data was found under the source root."
    exit 0
}

Write-Host ""
Write-Host "Top planned entries:"
$uniquePlan |
    Select-Object -First 20 RelativePath, Reason, @{Name = "Bytes"; Expression = { Format-Bytes -Bytes $_.Bytes } } |
    Format-Table -AutoSize

if (-not $Execute.IsPresent) {
    Write-Host ""
    Write-Host "Dry run only. Re-run with -Execute to copy missing files into the target root."
    exit 0
}

if (-not (Test-Path -LiteralPath $targetFull -PathType Container)) {
    New-Item -ItemType Directory -Path $targetFull | Out-Null
}

$copied = 0
foreach ($item in $copyPlan) {
    $targetParent = Split-Path -Parent $item.Target
    if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) {
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    }

    $copyArgs = @{
        LiteralPath = $item.Source
        Destination = $item.Target
    }
    if ($Overwrite.IsPresent) {
        $copyArgs["Force"] = $true
    }

    Copy-Item @copyArgs

    $targetItem = Get-Item -LiteralPath $item.Target -Force
    if ([long]$targetItem.Length -ne [long]$item.Bytes) {
        throw "Copied file length mismatch: $($item.RelativePath)"
    }
    $copied += 1
}

Write-Host ""
Write-Host "Copied $copied files into $targetFull. Source root was not modified."
