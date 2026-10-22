#!/usr/bin/env bash
# Resolves a CI build's version from git. A release is a branch (see release.yml): its name is
# the version, and the release creates the vX.Y.Z tag that later builds count from.
#   branch release/X.Y.Z (or release/vX.Y.Z) -> X.Y.Z-rc.<run>     (a release candidate)
#   anything else after a release            -> X.Y.Z+<n>.g<sha>   (n commits after vX.Y.Z)
#   anything else, nothing released yet      -> 0.0.0-dev+g<sha>
# Writes `version` to $GITHUB_OUTPUT when it exists, prints it and adds it to the job summary.
# Needs the full history and tags (checkout with fetch-depth: 0).
set -euo pipefail

semver='^[0-9]+\.[0-9]+\.[0-9]+$'
# On pull requests the source branch is GITHUB_HEAD_REF; on pushes, GITHUB_REF_NAME.
branch="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}}"
run="${GITHUB_RUN_NUMBER:-0}"
sha="$(git rev-parse --short=7 HEAD)"
candidate="${branch#release/}"
candidate="${candidate#v}"

if [[ "$branch" == release/* && "$candidate" =~ $semver ]]; then
  version="$candidate-rc.$run"
elif last="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)"; then
  ahead="$(git rev-list --count "$last..HEAD")"
  version="${last#v}+$ahead.g$sha"
else
  version="0.0.0-dev+g$sha"
fi

echo "Version: $version"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "version=$version" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "### Version \`$version\`" >> "$GITHUB_STEP_SUMMARY"
fi
