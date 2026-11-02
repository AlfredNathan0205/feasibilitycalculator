#!/usr/bin/env bash
# Builds the hand-over zip for CPL IT: source + docs, without build output or git history.
# Usage: scripts/make-handover-zip.sh [output-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-..}"
STAMP="$(date +%Y%m%d)"
NAME="cpl-feasibility-calculator-handover-$STAMP"
ZIP="$OUT/$NAME.zip"
rm -f "$ZIP"
zip -qr "$ZIP" . \
  -x "node_modules/*" ".next/*" ".git/*" "coverage/*" "dist/*" "test-results/*" \
     "playwright-report/*" ".vercel/*" ".env" ".env.local" ".env.*.local" "*.tsbuildinfo" ".DS_Store"
echo "$ZIP"
