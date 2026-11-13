#!/bin/bash
# Builds the plugin and pushes it to production as a tag on the "sully" remote.
# The server's post-receive hook checks the tag out into the live plugin folder.
# Usage: ./deploy.sh [-f]   (-f replaces a version that is already deployed)
set -euo pipefail

remote="sully"
cd "$(dirname "$0")"

force=""
[ "${1:-}" = "-f" ] && force="--force"

# Deploy only what is committed
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean: commit or stash first." >&2
  exit 1
fi
ver=$(sed -n 's/^Version: *//p' nostrly.php)
if [[ ! "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "No version found in nostrly.php" >&2
  exit 1
fi

./build.sh
commit=$(git rev-parse refs/build/latest)
if [ "$(git rev-parse "${commit}^")" != "$(git rev-parse HEAD)" ]; then
  echo "The build is not of the current commit." >&2
  exit 1
fi

echo "Pushing v${ver} to ${remote}..."
git push $force "$remote" "${commit}:refs/tags/v${ver}"
