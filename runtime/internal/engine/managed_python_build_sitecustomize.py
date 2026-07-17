"""Preserve Nimi Runtime's admitted Windows ACL on uv build workspaces."""

import os as _os


_nimi_original_mkdir = _os.mkdir
_nimi_uv_cache_value = _os.environ.get("UV_CACHE_DIR", "")
if _os.name == "nt" and _nimi_uv_cache_value:
    _nimi_uv_builds_root = _os.path.normcase(
        _os.path.realpath(_os.path.join(_nimi_uv_cache_value, "builds-v0"))
    )
else:
    _nimi_uv_builds_root = ""


def _nimi_uv_build_descendant(path):
    if not _nimi_uv_builds_root:
        return False
    try:
        candidate = _os.path.normcase(_os.path.realpath(_os.path.abspath(_os.fspath(path))))
        return (
            candidate != _nimi_uv_builds_root
            and _os.path.commonpath((_nimi_uv_builds_root, candidate))
            == _nimi_uv_builds_root
        )
    except (OSError, TypeError, ValueError):
        return False


def _nimi_managed_mkdir(path, mode=0o777, *, dir_fd=None):
    effective_mode = mode
    if dir_fd is None and mode == 0o700 and _nimi_uv_build_descendant(path):
        effective_mode = 0o777
    if dir_fd is None:
        return _nimi_original_mkdir(path, effective_mode)
    return _nimi_original_mkdir(path, effective_mode, dir_fd=dir_fd)


_os.mkdir = _nimi_managed_mkdir
