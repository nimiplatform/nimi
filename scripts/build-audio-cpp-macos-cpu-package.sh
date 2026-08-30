#!/bin/bash
set -euo pipefail

commit="26dcb5c4cf5aa016ae6285096a7b45f2671e5d17"
version="0.6.1"
archive_name="audiocpp-macos-arm64-cpu-release-${version}-${commit:0:8}.zip"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "audio.cpp macOS CPU package build requires darwin/arm64" >&2
  exit 1
fi

for tool in git cmake zip shasum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "required build tool is unavailable: $tool" >&2
    exit 1
  fi
done

output_root="${1:-$PWD/.nimi/local/packages/audio-cpp/${version}/darwin-arm64-cpu}"
mkdir -p "$output_root"
output_root="$(cd "$output_root" && pwd -P)"

work_root="$(mktemp -d "${TMPDIR:-/tmp}/nimi-audiocpp-macos-cpu.XXXXXX")"
trap 'rm -rf "$work_root"' EXIT

source_root="$work_root/audio.cpp"
build_root="$work_root/build"
stage_root="$work_root/stage"

git clone --filter=blob:none --no-checkout https://github.com/0xShug0/audio.cpp.git "$source_root"
git -C "$source_root" checkout --detach "$commit"
git -C "$source_root" submodule update --init --recursive

export SOURCE_DATE_EPOCH=0
prefix_map="-ffile-prefix-map=$work_root=/nimi-build -fdebug-prefix-map=$work_root=/nimi-build"
cmake -S "$source_root" -B "$build_root" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_C_FLAGS="$prefix_map" \
  -DCMAKE_CXX_FLAGS="$prefix_map" \
  -DCMAKE_EXE_LINKER_FLAGS="-Wl,-no_uuid" \
  -DENGINE_ENABLE_CUDA=OFF \
  -DENGINE_ENABLE_HIP=OFF \
  -DENGINE_ENABLE_VULKAN=OFF \
  -DENGINE_ENABLE_METAL=OFF \
  -DENGINE_ENABLE_OPENMP=OFF \
  -DGGML_OPENMP=OFF \
  -DENGINE_ENABLE_NATIVE_CPU=OFF \
  -DAUDIOCPP_MODEL_SET=full \
  -DAUDIOCPP_DEPLOYMENT_BUILD=ON \
  -DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=OFF
cmake --build "$build_root" --parallel "$(sysctl -n hw.logicalcpu)" --target audiocpp_cli

mkdir -p "$stage_root"
cp "$build_root/bin/audiocpp_cli" "$stage_root/audiocpp_cli"
cp "$source_root/README.md" "$stage_root/README.md"
cp "$source_root/LICENSE" "$stage_root/LICENSE"
chmod 0755 "$stage_root/audiocpp_cli"
chmod 0644 "$stage_root/README.md" "$stage_root/LICENSE"
touch -t 198001010000 "$stage_root/audiocpp_cli" "$stage_root/README.md" "$stage_root/LICENSE"

archive_path="$output_root/$archive_name"
rm -f "$archive_path"
(
  cd "$stage_root"
  COPYFILE_DISABLE=1 zip -X -9 "$archive_path" audiocpp_cli README.md LICENSE
)

archive_size="$(stat -f '%z' "$archive_path")"
archive_sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
binary_sha256="$(shasum -a 256 "$stage_root/audiocpp_cli" | awk '{print $1}')"

printf 'archive=%s\n' "$archive_path"
printf 'archive_bytes=%s\n' "$archive_size"
printf 'archive_sha256=%s\n' "$archive_sha256"
printf 'binary_sha256=%s\n' "$binary_sha256"
printf 'source_commit=%s\n' "$commit"
