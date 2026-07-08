#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   pnpm release            conventional-commit bump (changelogen decides)
#   pnpm release v0.3.0     release exactly this version (leading v optional)
#   pnpm release minor      force a patch / minor / major bump
VERSION="${1:-}"

npm run test
npm run prepack

case "$VERSION" in
    "")
        npx changelogen --release
        ;;
    major | minor | patch)
        # Compute the increment ourselves and pass it explicitly: changelogen
        # downshifts bumps on 0.x versions (major->minor, minor->patch), so
        # --minor on 0.1.13 would yield 0.1.14 instead of 0.2.0.
        BARE=$(node -p "require('semver').inc(require('./package.json').version, '$VERSION')")
        npx changelogen --release -r "$BARE"
        ;;
    *)
        BARE="${VERSION#v}"
        if ! [[ "$BARE" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$ ]]; then
            echo "Invalid version '$VERSION' — expected e.g. v0.3.0, 0.3.0, or major|minor|patch" >&2
            exit 1
        fi
        npx changelogen --release -r "$BARE"
        ;;
esac

npm publish
git push --follow-tags
