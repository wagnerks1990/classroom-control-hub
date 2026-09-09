#!/usr/bin/env bash
# Sourced by install.sh; stdout is only the verified group name.
ensure_hub_install_group(){
  local entry status name password gid members
  command -v getent >/dev/null 2>&1 || {
    echo 'Host group preflight requires getent (libc-bin).' >&2; return 1;
  }
  if entry="$(getent group 10001)"; then
    :
  else
    status=$?
    [[ "$status" -eq 2 ]] || {
      echo "Cannot query host GID 10001 (getent exit $status); no group changed." >&2; return 1;
    }
    if getent group classroom-hub >/dev/null; then
      echo 'Host group classroom-hub exists with another GID. Resolve the conflict without renumbering existing groups.' >&2
      return 1
    else
      status=$?
      [[ "$status" -eq 2 ]] || {
        echo "Cannot query host group classroom-hub (getent exit $status); no group changed." >&2; return 1;
      }
    fi
    command -v groupadd >/dev/null 2>&1 || {
      echo 'Host group preflight requires groupadd (passwd package).' >&2; return 1;
    }
    # Never use --force or --non-unique: the container requires exactly GID 10001.
    groupadd --system --gid 10001 classroom-hub || return 1
    entry="$(getent group 10001)" || {
      echo 'Host GID 10001 is not resolvable after group creation.' >&2; return 1;
    }
  fi
  [[ "$entry" != *$'\n'* ]] || {
    echo 'Ambiguous host GID 10001 lookup; refusing installation.' >&2; return 1;
  }
  IFS=: read -r name password gid members <<< "$entry"
  [[ -n "$name" && "$gid" == 10001 ]] || {
    echo 'Host group lookup returned an unexpected GID; refusing installation.' >&2; return 1;
  }
  printf '%s\n' "$name"
}
