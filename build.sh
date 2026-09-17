#!/bin/bash

pkg="nostrly-saas.zip" # plugin name

# Clear build assets
rm assets/js/nostrly*

# Build packages
composer install --no-dev
npm i
npm run format
npm run build

# Create plugin. Zip through a fixed top-level folder so WordPress always
# installs to plugins/nostrly-saas, whatever the uploaded file is called.
rm -f ${pkg}
echo "Creating zip file..."
dir="${pkg%.zip}"
stage=$(mktemp -d)
ln -s "$PWD" "${stage}/${dir}"
(cd "${stage}" && zip -rq "${OLDPWD}/${pkg}" "${dir}" -x="${dir}/.git/*" -x="${dir}/*/.git/*" -x="${dir}/vendor/*/tests/*" -x="${dir}/vendor/*/test/*" -x="${dir}/.well-known/*" -x="${dir}/src/*" -x="${dir}/node_modules/*" -x="${dir}/README.md" -x="${dir}/webpack.config.js" -x="${dir}/build.sh" -x="${dir}/eslint.config.js" -x="${dir}/package-lock.json" -x="${dir}/${pkg}" -x="*.DS_Store")
rm -r "${stage}"
echo "Done"
