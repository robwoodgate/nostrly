# AGENTS.md

Guidance for agentic coding assistants working in this repository.

## Project Overview

- WordPress plugin (`nostrly.php`) with PHP backend and TypeScript frontend bundles.
- PHP services in `lib/` register hooks, shortcodes, AJAX handlers, and admin customizations.
- TypeScript in `src/js/` compiles to minified assets in `assets/js/` via webpack.
- Tooling split: `npm` for frontend, `composer` for PHP dependencies.

## Source Layout

- `nostrly.php`: plugin bootstrap and class wiring.
- `lib/class-nostrly.php`: core settings, relay config, global script-localized data.
- `lib/class-nostrly-login.php`: Nostr login and profile sync/disconnect flows.
- `lib/class-nostrly-register.php`: registration, checkout, payment verification.
- `lib/class-nostrly-tools.php`: shortcode tools and frontend HTML output.
- `src/js/*.ts`: TS entrypoints and shared utility modules.
- `assets/js/*.min.js`: compiled JS artifacts consumed by WordPress.

## Build, Lint, and Validation Commands

Run commands from `/wp-content/plugins/nostrly`.

### Install

- `npm i`
- `composer install`

### Build

- `npm run build` (production bundle)
- `npm run build:dev` (development bundle)

### Lint and Formatting

- `npm run lint`
- `npm run format`

### Current Test Status

- No automated test framework is configured in this repo.
- No `npm test` script exists in `package.json`.

### Single-Test / Targeted Checks

Because there is no test runner, use these focused checks:

- `npx eslint src/js/nostrly-login.ts`
- `npx eslint src/js/utils.ts src/js/nostr.ts`
- `npx prettier --check src/js/nostrly-register.ts`
- `npx tsc --noEmit`

If a real test suite is added later, update this file with exact single-test commands.

## Packaging

- Build/package script: `./build.sh`
- Script currently:
  - removes previous generated `assets/js/nostrly*` bundles
  - runs `composer install --no-dev`
  - creates `nostrly-saas.zip` excluding source/dev folders

## Coding Style Guidelines

Prefer existing repository conventions over external defaults.

### General

- Keep changes scoped and avoid broad refactors unless requested.
- Preserve existing hook names, shortcode names, AJAX actions, and public behavior.
- Match local file patterns before introducing new abstractions.

### TypeScript

- Strict TS is enabled (`tsconfig.json`: `"strict": true`).
- ES module pipeline (`"type": "module"`, webpack + ts-loader).
- Prefer explicit parameter/return types for exported functions.
- Use `unknown` in new `catch` blocks, then narrow safely.
- Reuse utilities like `getErrorMessage` for consistent error extraction.

### Imports

- Keep imports at top of file.
- Group external imports first, local imports second.
- Follow the surrounding file's import order/style when editing.

### Formatting

- Prettier defaults apply (no local `.prettierrc` found).
- ESLint config is `.eslintrc.js` (`eslint:recommended` + `prettier`).
- Prefer double quotes in TS/JS to match current code.
- Do not hand-minify source files.

### Naming

- PHP classes: PascalCase with `Nostrly*` prefix.
- PHP file names: `class-nostrly-*.php`.
- TS files: kebab-case by feature (`nostrly-cashu-redeem.ts`).
- Functions/variables: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants; camelCase for scoped immutable values.

### Error Handling

- PHP: fail fast on nonce/capability/auth checks.
- PHP AJAX: use `wp_send_json_success()` / `wp_send_json_error()`.
- Sanitize user input before use and persistence.
- TS: show user-facing feedback via UI/toastr where needed; log technical detail to console.
- Avoid swallowing actionable errors unless graceful fallback is required.

### WordPress / PHP Practices

- Guard direct access with `if (!defined('ABSPATH')) { exit; }`.
- Use WP sanitization/escaping helpers (`sanitize_*`, `esc_*`).
- Verify nonces in AJAX handlers.
- Enforce capabilities for privileged actions (`current_user_can`).
- Keep hook wiring centralized inside each class `init()`/`register()`.

### Frontend / jQuery Practices

- Frontend code is jQuery-based in DOM-ready wrappers; follow existing binding style.
- Use `nostrly_ajax` localized config instead of hardcoding endpoints.
- Prefer helper functions for repeated UI state transitions.
- Do not log or expose sensitive key material.

## Security-Sensitive Areas

- `lib/class-nostrly-login.php` (authentication and account linking).
- `lib/class-nostrly-register.php` (checkout, payment, account creation).
- `src/js/nostr.ts` and Cashu TS entrypoints (keys/signing/token handling).
- In these paths: keep diffs small, validate inputs explicitly, and handle errors defensively.

## Cursor / Copilot Rule Files

Repository scan results:

- `.cursorrules`: not found
- `.cursor/rules/`: not found
- `.github/copilot-instructions.md`: not found

If added later, treat them as high-priority local instructions and update this file.

## Recommended Agent Workflow

- Before edits: read relevant PHP class + related TS entrypoint(s).
- After TS edits: run `npx tsc --noEmit` and `npm run build`.
- After style-heavy edits: run `npm run lint` and `npm run checkformat`.
- For PHP-only edits: run `php -l <file>` and manually validate impacted WordPress flow.
- In handoff notes, clearly list any checks that were skipped.
