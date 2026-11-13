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

echo "Building ${ver}..."
rm -f assets/js/nostrly*
composer install --no-dev --quiet
npm ci --ignore-scripts --no-audit --no-fund
npm run build

# Commit the built tree through a temporary index, so it never reaches a branch
GIT_INDEX_FILE="$(mktemp -d)/index"
export GIT_INDEX_FILE
git read-tree HEAD
git rm -r -q --cached --ignore-unmatch src .well-known README.md \
  webpack.config.js build.sh deploy.sh eslint.config.js package-lock.json
git add -f assets/js vendor
git rm -r -q --cached --ignore-unmatch ':(glob)vendor/**/tests/**' ':(glob)vendor/**/test/**'
commit=$(git commit-tree "$(git write-tree)" -p HEAD -m "build: ${ver}")

echo "Pushing v${ver} to ${remote}..."
git push $force "$remote" "${commit}:refs/tags/v${ver}"
