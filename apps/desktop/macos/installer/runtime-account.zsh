#!/bin/zsh
set -euo pipefail

readonly nimi_account="_nimiruntime"
readonly nimi_user_record="/Users/${nimi_account}"
readonly nimi_group_record="/Groups/${nimi_account}"
readonly nimi_directory_node="/Local/Default"

nimi_ds_record_exists() {
  /usr/bin/dscl "${nimi_directory_node}" -read "$1" >/dev/null 2>&1
}

nimi_ds_property() {
  local record="$1"
  local property="$2"
  /usr/bin/dscl "${nimi_directory_node}" -read "${record}" "${property}" \
    | /usr/bin/sed -n "s/^${property}: //p"
}

nimi_validate_runtime_account() {
  nimi_ds_record_exists "${nimi_user_record}" || return 1
  nimi_ds_record_exists "${nimi_group_record}" || return 1
  local uid gid user_gid
  uid="$(nimi_ds_property "${nimi_user_record}" UniqueID)"
  user_gid="$(nimi_ds_property "${nimi_user_record}" PrimaryGroupID)"
  gid="$(nimi_ds_property "${nimi_group_record}" PrimaryGroupID)"
  [[ "${uid}" == <200-499> && "${uid}" == "${gid}" && "${user_gid}" == "${gid}" ]] || return 1
  [[ "$(nimi_ds_property "${nimi_user_record}" NFSHomeDirectory)" == "/var/empty" ]] || return 1
  [[ "$(nimi_ds_property "${nimi_user_record}" UserShell)" == "/usr/bin/false" ]] || return 1
  [[ "$(nimi_ds_property "${nimi_user_record}" IsHidden)" == "1" ]] || return 1
  [[ "$(nimi_ds_property "${nimi_user_record}" AuthenticationAuthority)" == *"DisabledUser"* ]] || return 1
  [[ "$(/usr/bin/id -u "${nimi_account}")" == "${uid}" ]] || return 1
  [[ "$(/usr/bin/id -g "${nimi_account}")" == "${gid}" ]] || return 1
}

nimi_select_runtime_system_id() {
  local used candidate
  used="$({
    /usr/bin/dscl "${nimi_directory_node}" -list /Users UniqueID
    /usr/bin/dscl "${nimi_directory_node}" -list /Groups PrimaryGroupID
  } | /usr/bin/awk '{ print $NF }' | /usr/bin/sort -nu)"
  for candidate in {499..200}; do
    if ! /usr/bin/grep -qx -- "${candidate}" <<<"${used}"; then
      print -r -- "${candidate}"
      return 0
    fi
  done
  return 1
}

nimi_create_runtime_account() {
  if nimi_ds_record_exists "${nimi_user_record}" || nimi_ds_record_exists "${nimi_group_record}"; then
    print -u2 -- "partial or mismatched _nimiruntime Directory Services identity"
    return 1
  fi
  local system_id group_created=0 user_created=0
  system_id="$(nimi_select_runtime_system_id)" || {
    print -u2 -- "no collision-free macOS local system UID/GID is available"
    return 1
  }
  trap '
    if (( user_created == 1 )); then /usr/bin/dscl "${nimi_directory_node}" -delete "${nimi_user_record}" >/dev/null 2>&1 || true; fi
    if (( group_created == 1 )); then /usr/bin/dscl "${nimi_directory_node}" -delete "${nimi_group_record}" >/dev/null 2>&1 || true; fi
  ' ERR
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_group_record}"
  group_created=1
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_group_record}" PrimaryGroupID "${system_id}"
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_group_record}" RealName "Nimi Runtime Service"
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_group_record}" GeneratedUID "$(/usr/bin/uuidgen)"

  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}"
  user_created=1
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" UniqueID "${system_id}"
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" PrimaryGroupID "${system_id}"
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" RealName "Nimi Runtime Service"
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" NFSHomeDirectory /var/empty
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" UserShell /usr/bin/false
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" IsHidden 1
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" Password '*'
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" AuthenticationAuthority ';DisabledUser;'
  /usr/bin/dscl "${nimi_directory_node}" -create "${nimi_user_record}" GeneratedUID "$(/usr/bin/uuidgen)"
  nimi_validate_runtime_account
  user_created=0
  group_created=0
  trap - ERR
}

nimi_ensure_runtime_account() {
  if nimi_ds_record_exists "${nimi_user_record}" || nimi_ds_record_exists "${nimi_group_record}"; then
    nimi_validate_runtime_account || {
      print -u2 -- "existing _nimiruntime identity does not match the admitted non-login profile"
      return 1
    }
    return 0
  fi
  nimi_create_runtime_account
}
