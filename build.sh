#!/bin/bash

pkg="nostrly-saas.zip" # plugin name

# Clear build assets
rm assets/js/nostrly*

# Build packages
composer install --no-dev
# npm i
npm run format
npm run build

# Create plugin
rm ${pkg}
echo "Creating zip file..."
zip -rq ${pkg} . -x='.git/*' -x='.well-known/*' -x="src/*" -x="node_modules/*" -x="README.md" -x="webpack.config.js" -x="build.sh" -x="*.DS_Store"
echo "Done"
