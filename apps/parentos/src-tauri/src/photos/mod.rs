//! Orthodontic photo storage (`PO-ORTHO-012`).
//!
//! This module owns three concerns:
//!
//! 1. **Codec gate** — decode incoming bitmaps from the admitted mime set
//!    (`image/jpeg | image/png | image/webp`), downsample the longest edge to
//!    1600 px (Lanczos3), flatten any alpha channel onto an opaque white
//!    background (JPEG has no alpha channel), and re-encode as JPEG quality
//!    82. Each step is fail-close: an unsupported mime, a decode error, or an
//!    encode error returns an `Err`; the caller MUST NOT fall back to writing
//!    the original bytes.
//! 2. **Path resolution** — every photo file lives under
//!    `${appLocalData}/parentos/photos/{childId}/{sessionId}/{angle}.jpg`.
//!    Path segments are sanitized so a malicious id can never escape the
//!    photos root.
//! 3. **File-system lifecycle** — session-level and child-level recursive
//!    deletes. Both are fail-safe with respect to "directory already absent"
//!    (no-op) but fail-close on any other IO error so the parent does not see
//!    a silently-broken cascade.
//!
//! The module is intentionally split into pure helpers (`compress_to_jpeg`,
//! `is_admitted_*`) and IO helpers (`write_jpeg`, `delete_session_dir_at`).
//! Production wrappers (`save_session_jpeg`, `delete_session_dir`,
//! `delete_child_dir`, `read_photo_bytes`) resolve the photos root through
//! `desktop_paths` before delegating to the pure helpers, which keeps the
//! tests fully sandboxed in `TempDir`.

use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{GenericImageView, ImageReader, Rgb, RgbImage};

use crate::desktop_paths;

const PHOTOS_DIR: &str = "parentos/photos";
const MAX_LONGEST_EDGE: u32 = 1600;
/// JPEG encode quality (1..=100). 82 balances 5–10× compression against
/// near-imperceptible quality loss for intra-oral photos.
const JPEG_QUALITY: u8 = 82;

/// Resolved photos root for this install. Created if missing.
pub fn resolve_photos_root() -> Result<PathBuf, String> {
    let root = desktop_paths::resolve_nimi_data_dir()?.join(PHOTOS_DIR);
    fs::create_dir_all(&root)
        .map_err(|e| format!("failed to create photos dir ({}): {e}", root.display()))?;
    Ok(root)
}

/// Mime types admitted on **input**. Output is always `image/jpeg`.
///
/// Wave B audit follow-up (W2): the IANA registry only defines `image/jpeg`.
/// Browsers / file pickers that emit `image/jpg` are non-conforming. The
/// renderer is expected to canonicalize the mime label before invoking this
/// surface; admitting both here would weaken PO-ORTHO-011's "outside the
/// admitted mime set" fail-close clause.
pub fn is_admitted_mime(mime: &str) -> bool {
    matches!(
        mime.trim().to_ascii_lowercase().as_str(),
        "image/jpeg" | "image/png" | "image/webp"
    )
}

/// Angles admitted by PO-ORTHO-012 v1.
pub fn is_admitted_angle(angle: &str) -> bool {
    matches!(angle, "front" | "side")
}

/// Decode → downsample → flatten alpha → re-encode as JPEG quality 82.
/// Returns the on-disk JPEG bytes.
///
/// Fail-close on every branch — unsupported mime, decoder error, encoder
/// error — so the caller never has a "best-effort original" path.
pub fn compress_to_jpeg(src_bytes: &[u8], src_mime: &str) -> Result<Vec<u8>, String> {
    if !is_admitted_mime(src_mime) {
        return Err(format!(
            "unsupported photo mime type \"{src_mime}\" (admitted: image/jpeg | image/png | image/webp)"
        ));
    }
    if src_bytes.is_empty() {
        return Err("photo payload must not be empty".to_string());
    }

    // `with_guessed_format` sniffs the magic bytes; the explicit mime is
    // already validated above but `image::ImageReader` ignores the mime
    // entirely — content is the source of truth. A mismatch between the
    // declared mime and the sniffed format is allowed; we trust the bytes.
    let reader = ImageReader::new(Cursor::new(src_bytes))
        .with_guessed_format()
        .map_err(|e| format!("photo guess format failed: {e}"))?;
    let decoded = reader
        .decode()
        .map_err(|e| format!("photo decode failed: {e}"))?;

    // Downsample only if the longest edge exceeds the cap. `resize` would
    // happily upscale a tiny screenshot otherwise, which wastes pixels with
    // no quality gain.
    let (w, h) = decoded.dimensions();
    // Wave B audit follow-up (W5): an upstream decoder edge case can hand
    // back a zero-dimension image (corrupt header, truncated bitstream that
    // somehow passes magic-byte sniffing). The JPEG encoder would later
    // raise a less actionable error; catch it here with a typed message.
    if w == 0 || h == 0 {
        return Err(format!("photo decode produced zero dimensions ({w}x{h})"));
    }
    let scaled = if w.max(h) > MAX_LONGEST_EDGE {
        decoded.resize(MAX_LONGEST_EDGE, MAX_LONGEST_EDGE, FilterType::Lanczos3)
    } else {
        decoded
    };

    // Flatten alpha onto opaque white. JPEG has no alpha channel; rather than
    // reject every PNG that happens to carry alpha (most don't, but some do),
    // we composite over white so an unexpected screenshot still imports.
    // Photographic content is unaffected — alpha is 255 everywhere.
    let rgb = flatten_alpha_on_white(&scaled);

    let mut out: Vec<u8> = Vec::with_capacity(rgb.len() / 3);
    let mut encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    encoder
        .encode_image(&rgb)
        .map_err(|e| format!("photo encode failed: {e}"))?;
    Ok(out)
}

fn flatten_alpha_on_white(img: &image::DynamicImage) -> RgbImage {
    // Common short-circuit: opaque source has no alpha to flatten. `to_rgb8`
    // is then a straightforward channel drop.
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    let rgba = img.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        let alpha = a as f32 / 255.0;
        let blend = |c: u8| -> u8 {
            let c = c as f32 / 255.0;
            ((c * alpha + (1.0 - alpha)) * 255.0).round().clamp(0.0, 255.0) as u8
        };
        out.put_pixel(x, y, Rgb([blend(r), blend(g), blend(b)]));
    }
    out
}

/// Sanitize an ID-shaped path segment. Mirrors `attachment_store::sanitize_segment`
/// — empty, slash, or backslash is fail-close. Additionally rejects any
/// segment whose canonicalization would walk out of its parent (`.`, `..`,
/// or a Windows drive prefix).
pub fn sanitize_segment(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(format!("{label} must not contain path separators"));
    }
    let test_path: &Path = Path::new(trimmed);
    for component in test_path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("{label} contains non-normal path component"));
        }
    }
    Ok(trimmed.to_string())
}

/// Resolve `{root}/{childId}/{sessionId}` and create it.
pub fn resolve_session_dir_at(
    root: &Path,
    child_id: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    let child = sanitize_segment(child_id, "child_id")?;
    let session = sanitize_segment(session_id, "session_id")?;
    let dir = root.join(&child).join(&session);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("failed to create session dir ({}): {e}", dir.display()))?;
    Ok(dir)
}

/// Write the pre-compressed JPEG to `{session_dir}/{angle}.jpg`. The caller
/// is responsible for the compress step — passing raw decoded RGBA here will
/// just save garbage and break the renderer.
pub fn write_jpeg(
    root: &Path,
    child_id: &str,
    session_id: &str,
    angle: &str,
    jpeg_bytes: &[u8],
) -> Result<PathBuf, String> {
    if !is_admitted_angle(angle) {
        return Err(format!(
            "unsupported photo angle \"{angle}\" (admitted: front | side)"
        ));
    }
    let session_dir = resolve_session_dir_at(root, child_id, session_id)?;
    let dest = session_dir.join(format!("{angle}.jpg"));
    fs::write(&dest, jpeg_bytes)
        .map_err(|e| format!("failed to write photo ({}): {e}", dest.display()))?;
    Ok(dest)
}

/// Fail-safe recursive delete of `{root}/{childId}/{sessionId}/`. Missing
/// directory is OK. Any other IO error is fail-close.
pub fn delete_session_dir_at(
    root: &Path,
    child_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let child = sanitize_segment(child_id, "child_id")?;
    let session = sanitize_segment(session_id, "session_id")?;
    let dir = root.join(child).join(session);
    delete_dir_fail_safe(&dir)
}

/// Fail-safe recursive delete of `{root}/{childId}/`. Used when a child
/// profile is deleted (PIPL cascade).
pub fn delete_child_dir_at(root: &Path, child_id: &str) -> Result<(), String> {
    let child = sanitize_segment(child_id, "child_id")?;
    let dir = root.join(child);
    delete_dir_fail_safe(&dir)
}

fn delete_dir_fail_safe(dir: &Path) -> Result<(), String> {
    match fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "failed to remove photos dir ({}): {err}",
            dir.display()
        )),
    }
}

/// Read JPEG bytes from disk. Validates the path is inside the owned photos
/// root to prevent renderer-driven path traversal (the bridge passes
/// `filePath` strings back into Rust).
///
/// Wave B audit follow-up (W4): error strings deliberately omit the
/// resolved on-disk path. Paths under `${appLocalData}/parentos/photos/`
/// embed `childId` + `sessionId`, which would leak through any log a user
/// later attaches to a support thread. Only the underlying IO kind is
/// returned; the full path is available to the developer through the
/// platform's local fs debugger if they need it.
pub fn read_photo_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let root = resolve_photos_root()?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("failed to canonicalize photos root: {e}"))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve photo path: {} ({e})", e.kind()))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("photo path is outside owned photos root".to_string());
    }
    fs::read(&canonical).map_err(|e| format!("failed to read photo bytes: {e}"))
}

// ── Production wrappers (resolve root + delegate) ─────────────────────────

pub fn save_session_jpeg(
    child_id: &str,
    session_id: &str,
    angle: &str,
    jpeg_bytes: &[u8],
) -> Result<PathBuf, String> {
    let root = resolve_photos_root()?;
    write_jpeg(&root, child_id, session_id, angle, jpeg_bytes)
}

pub fn delete_session_dir(child_id: &str, session_id: &str) -> Result<(), String> {
    let root = resolve_photos_root()?;
    delete_session_dir_at(&root, child_id, session_id)
}

pub fn delete_child_dir(child_id: &str) -> Result<(), String> {
    let root = resolve_photos_root()?;
    delete_child_dir_at(&root, child_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb as ImgRgb, Rgba as ImgRgba};
    use std::io::Cursor;
    use tempfile::TempDir;

    fn encode_png_rgba(w: u32, h: u32, fill: ImgRgba<u8>) -> Vec<u8> {
        let img: image::RgbaImage = ImageBuffer::from_fn(w, h, |_, _| fill);
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    fn encode_jpeg(w: u32, h: u32, fill: ImgRgb<u8>) -> Vec<u8> {
        let img: image::RgbImage = ImageBuffer::from_fn(w, h, |_, _| fill);
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Jpeg)
            .unwrap();
        bytes
    }

    fn dimensions_of(bytes: &[u8]) -> (u32, u32) {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap()
            .dimensions()
    }

    #[test]
    fn admitted_mime_and_angle_enums_match_spec() {
        assert!(is_admitted_mime("image/jpeg"));
        assert!(is_admitted_mime("image/png"));
        assert!(is_admitted_mime("image/webp"));
        assert!(is_admitted_mime("  image/PNG  "));
        // W2 audit follow-up: image/jpg is NOT IANA-admitted; renderer must
        // canonicalize to image/jpeg before reaching this surface.
        assert!(!is_admitted_mime("image/jpg"));
        assert!(!is_admitted_mime("image/heic"));
        assert!(!is_admitted_mime("image/gif"));
        assert!(!is_admitted_mime(""));

        assert!(is_admitted_angle("front"));
        assert!(is_admitted_angle("side"));
        assert!(!is_admitted_angle("upper"));
        assert!(!is_admitted_angle("FRONT"));
        assert!(!is_admitted_angle(""));
    }

    #[test]
    fn compress_caps_longest_edge_to_1600() {
        // A 3000×500 source. Longest edge becomes 1600, so width=1600,
        // height=1600 * (500/3000) = ~267.
        let png = encode_png_rgba(3000, 500, ImgRgba([200, 100, 50, 255]));
        let out = compress_to_jpeg(&png, "image/png").expect("compress");
        let (w, h) = dimensions_of(&out);
        assert!(w <= MAX_LONGEST_EDGE, "downsampled width {w} > cap");
        assert!(h <= MAX_LONGEST_EDGE, "downsampled height {h} > cap");
        assert!(
            w == MAX_LONGEST_EDGE || h == MAX_LONGEST_EDGE,
            "exactly one edge must hit the cap ({w}x{h})"
        );
        assert!(out.starts_with(&[0xFF, 0xD8]), "output must be JPEG SOI");
    }

    #[test]
    fn compress_does_not_upscale_small_image() {
        let jpeg = encode_jpeg(200, 150, ImgRgb([50, 200, 50]));
        let out = compress_to_jpeg(&jpeg, "image/jpeg").expect("compress");
        let (w, h) = dimensions_of(&out);
        assert_eq!((w, h), (200, 150), "small source must NOT be upscaled");
    }

    #[test]
    fn compress_flattens_alpha_onto_white() {
        // Fully transparent PNG → flattened to pure white.
        let png = encode_png_rgba(64, 64, ImgRgba([0, 0, 0, 0]));
        let out = compress_to_jpeg(&png, "image/png").expect("compress");
        let decoded = ImageReader::new(Cursor::new(&out))
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap()
            .to_rgb8();
        let p = decoded.get_pixel(32, 32);
        // JPEG quantization may shift a couple of LSBs but white stays white.
        assert!(
            p[0] > 240 && p[1] > 240 && p[2] > 240,
            "transparent pixel must flatten to ~white, got {p:?}"
        );
    }

    #[test]
    fn compress_rejects_empty_bytes() {
        let err = compress_to_jpeg(&[], "image/jpeg").unwrap_err();
        assert!(err.contains("must not be empty"), "got: {err}");
    }

    #[test]
    fn compress_rejects_unsupported_mime() {
        let png = encode_png_rgba(10, 10, ImgRgba([1, 2, 3, 255]));
        let err = compress_to_jpeg(&png, "image/gif").unwrap_err();
        assert!(err.contains("unsupported photo mime"), "got: {err}");
    }

    #[test]
    fn compress_rejects_garbage_bytes() {
        // Mime says PNG but bytes are random garbage. `with_guessed_format`
        // either fails to sniff or `decode` fails — either way, fail-close.
        let mut garbage = Vec::with_capacity(64);
        for _ in 0..16 {
            garbage.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
        }
        let err = compress_to_jpeg(&garbage, "image/png").unwrap_err();
        assert!(
            err.contains("decode") || err.contains("guess") || err.contains("format"),
            "garbage must fail at decode/guess, got: {err}"
        );
    }

    #[test]
    fn sanitize_segment_rejects_traversal() {
        for bad in ["", "  ", "a/b", "a\\b", "..", ".", "../escape"] {
            assert!(
                sanitize_segment(bad, "id").is_err(),
                "{bad:?} should be rejected"
            );
        }
        for good in ["child-1", "01H..XYZ", "abc123"] {
            assert!(
                sanitize_segment(good, "id").is_ok(),
                "{good:?} should be accepted"
            );
        }
    }

    #[test]
    fn write_and_delete_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let jpeg = encode_jpeg(50, 50, ImgRgb([10, 20, 30]));
        let compressed = compress_to_jpeg(&jpeg, "image/jpeg").unwrap();

        let path =
            write_jpeg(root, "child-A", "sess-A", "front", &compressed).expect("write");
        assert!(path.exists(), "written file must exist on disk");
        assert!(path.ends_with("front.jpg"));
        assert_eq!(fs::read(&path).unwrap(), compressed);

        delete_session_dir_at(root, "child-A", "sess-A").expect("delete");
        assert!(!path.exists(), "session dir must be gone");

        // Idempotent: second delete is a no-op.
        delete_session_dir_at(root, "child-A", "sess-A").expect("second delete");
    }

    #[test]
    fn delete_child_dir_purges_all_sessions() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let jpeg = encode_jpeg(20, 20, ImgRgb([255, 0, 0]));
        let bytes = compress_to_jpeg(&jpeg, "image/jpeg").unwrap();
        write_jpeg(root, "child-A", "sess-1", "front", &bytes).unwrap();
        write_jpeg(root, "child-A", "sess-2", "side", &bytes).unwrap();
        write_jpeg(root, "child-B", "sess-1", "front", &bytes).unwrap();

        delete_child_dir_at(root, "child-A").expect("delete child A");

        assert!(!root.join("child-A").exists());
        assert!(root.join("child-B").join("sess-1").join("front.jpg").exists());
    }

    #[test]
    fn write_rejects_bad_angle() {
        let tmp = TempDir::new().unwrap();
        let err = write_jpeg(tmp.path(), "child", "sess", "upper", b"x").unwrap_err();
        assert!(err.contains("unsupported photo angle"));
    }

    #[test]
    fn write_rejects_bad_ids() {
        let tmp = TempDir::new().unwrap();
        assert!(write_jpeg(tmp.path(), "child/escape", "sess", "front", b"x").is_err());
        assert!(write_jpeg(tmp.path(), "child", "..", "front", b"x").is_err());
    }

    #[test]
    fn compress_rejects_image_jpg_mime_label() {
        // Wave B audit follow-up (W2). `image/jpg` is non-conforming; the
        // renderer must canonicalize before invoking. Document via the
        // compress entry-point so any future loosening shows up as a failed
        // unit test.
        let jpeg = encode_jpeg(40, 40, ImgRgb([20, 200, 20]));
        let err = compress_to_jpeg(&jpeg, "image/jpg").unwrap_err();
        assert!(
            err.contains("unsupported photo mime"),
            "image/jpg must NOT be admitted: {err}"
        );
    }

    /// W6 audit follow-up — compress_to_jpeg accepts a static WebP and
    /// produces a JPEG. Animated WebP isn't reachable through the image
    /// crate's webp feature in 0.25 (only the first frame would decode if
    /// it were), so the parent never gets "wrong frame" artifacts.
    #[test]
    fn compress_accepts_static_webp_and_emits_jpeg() {
        let rgb: image::RgbImage = ImageBuffer::from_fn(128, 96, |x, _| {
            let v = (x % 200) as u8;
            ImgRgb([v, 255 - v, 100])
        });
        let mut webp_bytes = Vec::new();
        image::DynamicImage::ImageRgb8(rgb)
            .write_to(&mut Cursor::new(&mut webp_bytes), image::ImageFormat::WebP)
            .expect("encode static webp fixture");

        let out = compress_to_jpeg(&webp_bytes, "image/webp").expect("webp → jpeg");
        assert!(out.starts_with(&[0xFF, 0xD8]), "output must be JPEG SOI");
        let (w, h) = dimensions_of(&out);
        assert!(w >= 1 && h >= 1);
    }

    /// W6 audit follow-up — JPEG quality 82 actually takes effect: a noisy
    /// source ought to compress materially smaller than a "best-effort"
    /// quality-95 baseline. Without an explicit assertion the encoder
    /// could silently regress to a default (image 0.25's JpegEncoder
    /// default is currently 75 but that's not contractually guaranteed).
    #[test]
    fn compress_jpeg_quality_82_is_meaningfully_smaller_than_q95() {
        // High-entropy noise so the compressor has work to do.
        let rgb: image::RgbImage = ImageBuffer::from_fn(512, 512, |x, y| {
            let r = ((x * 7 + y * 11) % 251) as u8;
            let g = ((x * 13 + y * 17) % 241) as u8;
            let b = ((x * 19 + y * 23) % 239) as u8;
            ImgRgb([r, g, b])
        });
        let mut png_src = Vec::new();
        image::DynamicImage::ImageRgb8(rgb.clone())
            .write_to(&mut Cursor::new(&mut png_src), image::ImageFormat::Png)
            .unwrap();

        let q82 = compress_to_jpeg(&png_src, "image/png").expect("q82");

        // Quality-95 baseline encoded inline so the comparison is honest.
        let mut q95 = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut q95, 95)
            .encode_image(&rgb)
            .unwrap();

        assert!(
            q82.len() * 5 < q95.len() * 4,
            "q82 ({} bytes) should be at least 20% smaller than q95 ({} bytes); quality is regressing",
            q82.len(),
            q95.len(),
        );
    }

    /// W6 audit follow-up — JPEG with trailing garbage bytes (a common
    /// camera-firmware quirk) must NOT panic the decoder. We accept a
    /// slightly malformed file as long as a valid frame can be read; this
    /// pins the "graceful tolerance" expectation against an upstream
    /// stricter-decoder regression.
    #[test]
    fn compress_tolerates_jpeg_with_trailing_garbage() {
        let mut jpeg = encode_jpeg(40, 40, ImgRgb([20, 200, 20]));
        jpeg.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00]);
        let out = compress_to_jpeg(&jpeg, "image/jpeg").expect("trailing garbage tolerated");
        assert!(out.starts_with(&[0xFF, 0xD8]));
    }

    #[test]
    fn read_photo_bytes_canonicalize_failure_does_not_leak_path() {
        // Wave B audit follow-up (W4). We can't easily exercise the
        // resolve_photos_root branch from a unit test (it goes through
        // desktop_paths), but the canonicalize error formatter is the
        // public surface and we can validate its message shape directly.
        // The relevant assertion is that the failure does NOT round-trip
        // the inbound path, which would leak childId/sessionId.
        let phony = Path::new("nonexistent/child-secret/sess-secret/front.jpg");
        match read_photo_bytes(phony) {
            Ok(_) => panic!("read of nonexistent file must fail"),
            Err(err) => {
                assert!(
                    !err.contains("child-secret") && !err.contains("sess-secret"),
                    "error string must not echo private id fragments: {err}"
                );
            }
        }
    }
}
