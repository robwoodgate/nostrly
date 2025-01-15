#!/bin/bash

pfx="nostrly" # plugin name
pkg="build/${pfx}.zip"

composer install
npm run build

git archive --format zip --prefix=${pfx}/ --output $pkg main
