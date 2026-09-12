#!/usr/bin/env bash

# Verify that a locally pulled image was built from the exact trusted Git
# commit selected by the installer/updater. Version text alone is not a source
# identity because two different commits can report the same VERSION.
roomgoblin_verify_image_revision(){
  local image="$1" expected="$2" observed
  [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || {
    echo "Invalid expected RoomGoblin source revision" >&2
    return 1
  }
  observed="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null || true)"
  if [[ "$observed" != "$expected" ]]; then
    echo "Image source revision mismatch for $image: expected $expected, observed ${observed:-missing}" >&2
    return 1
  fi
}
