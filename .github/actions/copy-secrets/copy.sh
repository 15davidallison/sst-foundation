#!/usr/bin/env bash
# Copies BASE_STAGE's secret values to STAGE (previews) without ever printing a value.
#
# `sst secret list` writes NAME=value lines and `sst secret load` echoes each name it sets. A value that spans several
# lines (a PEM private key) breaks that format: its continuation lines are read as names and printed in the job log
# (offering run 45499115820, 2026-11-24). So every non-blank line must start with a secret name and `=`; otherwise
# nothing is copied. Store such values on one line (base64). Only counts are logged; `sst secret load`'s own output
# is never shown, except its error lines.
set -euo pipefail
: "${BASE_STAGE:?BASE_STAGE is required}" "${STAGE:?STAGE is required}"
umask 077
tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
f="$(mktemp "$tmp/preview-secrets.XXXXXX")"
log="$(mktemp "$tmp/preview-secrets-load.XXXXXX")"
trap 'rm -f "$f" "$log"' EXIT

npx sst secret list --stage "$BASE_STAGE" > "$f"
if ! grep -q '[^[:space:]]' "$f"; then
  echo "Base stage $BASE_STAGE has no secret values"
  exit 0
fi

# Lines that don't start with NAME=. Nothing from the file is ever printed, not even names: once a value spans lines,
# a continuation line can look like NAME= (base64 ending in "=="), so a "name" could be part of a key.
bad=$(awk '!/^[[:space:]]*$/ && !/^[A-Za-z][A-Za-z0-9_]*=/' "$f" | wc -l | tr -d ' ')
if [ "$bad" != 0 ]; then
  msg="A secret value on $BASE_STAGE spans several lines ($bad line(s) don't start with NAME=), often a PEM key. Previews can't copy it safely, so nothing was copied. Find it with \`sst secret list --stage $BASE_STAGE\` on your machine and store it on one line (e.g. base64): sst secret set <NAME> <value> --stage $BASE_STAGE"
  echo "::error title=Multi-line secret on $BASE_STAGE::$msg"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && { echo "### Preview secrets not copied"; echo; echo "$msg"; } >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi

count=$(grep -c -v '^[[:space:]]*$' "$f" || true)
if ! npx sst secret load --stage "$STAGE" "$f" > "$log" 2>&1; then
  echo "::error::Copying secrets from $BASE_STAGE to $STAGE failed:"
  grep -E '✕|[Ee]rror' "$log" | grep -v '^✓' || true
  exit 1
fi
echo "Copied $count secret value(s) from $BASE_STAGE to $STAGE"
