# Nostrly

Powers the Cogmentis Nostrly SaaS

## Transparency Notice

The plugin code is provided open-source for transparency. It is currently under active development and depends on custom development branches of [robwoodgate/cashu-ts](https://github.com/robwoodgate/cashu-ts).

Because of this, it may not build correctly unless the appropriate feature branch is manually compiled into the `node_modules` directory first.

**Note**: This plugin is pre-release and experimental. It is not recommended for production use.

## Prerequisites

- A WordPress environment (local or remote installation)
- Node.js and npm (Node Package Manager) installed
- Composer installed for managing WordPress dependencies
- The PHP-GMP extension enabled on your WordPress server

## Installation

To install and set up the plugin:

1. Run the build script: `./build.sh`
2. Upload `nostrly-saas.zip` to the `/wp-content/plugins/` directory and unzip
3. Activate the plugin through the 'Plugins' menu
4. Go to Settings > Nostrly to configure relay settings

## Contributing

Contributions are welcome! Please open issues or submit pull requests.

This project is built against a development branch of @cashu/cashu-ts. To replicate the development environment, follow these steps:

1. Clone the fork locally, for example: `git clone https://github.com/robwoodgate/cashu-ts.git`
2. Checkout the desired branch (e.g., `development`): `git checkout development`
3. Install cashu-ts dependencies: `npm install`
4. Compile cashu-ts: `npm run compile`
5. Update Nostrly package.json to use your local copy by changing the line to: `"@cashu/cashu-ts": "file:./path-to-your/cashu-ts"`
6. Run `./build.sh` in the nostrly directory to confirm it builds successfully

## DISCLAIMER

This plugin is pre-release and experimental. Use it at your own risk.

It is not recommended for production use on other websites at this time.
