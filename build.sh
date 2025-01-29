#!/bin/bash

pkg="nostrly-saas.zip" # plugin name

# Build packages
composer install --no-dev
npm run build

# Create plugin
rm ${pkg}
zip -r ${pkg} . -x='.git/*' -x='.well-known/*' -x="src/*" -x="node_modules/*" -x="README.md" -x="webpack.config.js" -x="build.sh" -x="*.DS_Store"
echo "Done"
