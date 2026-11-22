#!/usr/bin/env bash
# Builds the optional face-swap detector (GenD CLIP-L/14, FP16, ~609 MB) into public/models/. Needs Python 3.9+, network, ~4 GB free disk.
set -euo pipefail
cd "$(dirname "$0")/../.."
VENV=.venv-people
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q -r scripts/people/requirements.txt
mkdir -p public/models
"$VENV/bin/python" scripts/people/export_gend.py public/models "$@"
echo "done. rebuild the extension: npm run build"
