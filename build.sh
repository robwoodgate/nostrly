#!/bin/bash
# Builds the plugin and zips it. What ships is every file in the working tree
# that is not git-ignored or marked export-ignore in .gitattributes, plus the
# build outputs below. The built tree is kept as a commit at refs/build/latest.
set -euo pipefail
cd "$(dirname "$0")"

pkg="nostrly-saas.zip"     # plugin name
outputs=(assets/js vendor) # git-ignored build outputs that ship

# Build packages
rm -f assets/js/nostrly*
composer install --no-dev --quiet
npm ci --ignore-scripts --no-audit --no-fund
npm run build

# Assemble the tree in a temporary index, so nothing built reaches a branch
GIT_INDEX_FILE="$(mktemp -d)/index"
export GIT_INDEX_FILE
git read-tree HEAD
git add -A .
git add -f "${outputs[@]}"
git ls-files -z | git check-attr --stdin -z export-ignore |
  while IFS= read -r -d '' path && IFS= read -r -d '' _ && IFS= read -r -d '' value; do
    if [ "$value" = "set" ]; then printf '%s\0' "$path"; fi
  done | xargs -0 git rm -q --cached --
ver=$(sed -n 's/^Version: *//p' nostrly.php)
commit=$(git commit-tree "$(git write-tree)" -p HEAD -m "build: ${ver}")
git update-ref refs/build/latest "$commit"

# Zip through a fixed top-level folder so WordPress always installs to
# plugins/nostrly-saas, whatever the uploaded file is called.
echo "Creating zip file..."
rm -f "${pkg}"
git archive --format=zip --prefix="${pkg%.zip}/" -o "${pkg}" "$commit"
echo "Done: ${pkg} ($(git ls-tree -r --name-only "$commit" | wc -l | tr -d ' ') files)"
