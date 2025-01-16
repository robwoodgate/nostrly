#!/bin/bash

pfx="nostrly" # plugin name
pkg="build/${pfx}.zip"

composer install
npm run build

rm -fr build/*
git archive --format zip --worktree-attribute --prefix=${pfx}/ --output $pkg main
unzip ${pkg} -d build/ && rm ${pkg}
cp -r vendor/ build/${pfx}/vendor/
cp -r assets/ build/${pfx}/assets/
cd build/
zip -r "${pfx}.zip" "${pfx}"
