#!/usr/bin/env bash
# Builds the PGD-cloak model files into public/models/ (git-ignored, ~213 MB). Needs Python 3.9+ and network.
set -euo pipefail
cd "$(dirname "$0")/../.."
VENV=.venv-cloak
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q -r scripts/cloak/requirements.txt
"$VENV/bin/pip" install -q --no-deps facenet-pytorch==2.6.0   # pinned old torchvision metadata; works with the versions above
mkdir -p public/models
"$VENV/bin/python" scripts/cloak/export_gradient_onnx.py vggface2 public/models/cloak-facenet-vggface2.onnx
"$VENV/bin/python" scripts/cloak/export_gradient_onnx.py casia-webface public/models/cloak-facenet-casia.onnx
node scripts/fetch-models.mjs   # face detector
echo "done. rebuild the extension: npm run build"
