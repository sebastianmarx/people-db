#!/usr/bin/env bash
# Builds backend/build/lambda.zip for the Lambda runtime.
#
# Dependencies are downloaded as Linux/aarch64 wheels regardless of the machine
# running this script, so the artefact is identical from a laptop or from CI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
BUILD="$BACKEND/build"
PKG="$BUILD/pkg"

PY_VERSION="3.13"
PLATFORM="manylinux2014_aarch64"

rm -rf "$BUILD"
mkdir -p "$PKG"

echo "→ installing dependencies for $PLATFORM / python$PY_VERSION"
python3 -m pip install \
  --quiet \
  --requirement "$BACKEND/requirements.txt" \
  --disable-pip-version-check \
  --no-warn-conflicts \
  --target "$PKG" \
  --platform "$PLATFORM" \
  --python-version "$PY_VERSION" \
  --implementation cp \
  --only-binary=:all: \
  --upgrade

echo "→ adding application code"
cp -r "$BACKEND/app" "$PKG/app"

# Trim things the runtime never reads. Smaller package, faster cold start.
find "$PKG" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG" -type d -name '*.dist-info' -prune -exec rm -rf {} + 2>/dev/null || true
find "$PKG" -type f -name '*.pyc' -delete 2>/dev/null || true

echo "→ zipping"
# Python's zipfile is used rather than `zip` so the script has no dependency
# beyond Python itself, and so mtimes are fixed for a reproducible artefact.
python3 - "$PKG" "$BUILD/lambda.zip" <<'PYZIP'
import os, sys, zipfile

source, target = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for root, dirs, files in os.walk(source):
        dirs.sort()
        for name in sorted(files):
            path = os.path.join(root, name)
            info = zipfile.ZipInfo(os.path.relpath(path, source), date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o755 << 16 if os.access(path, os.X_OK) else 0o644 << 16
            with open(path, "rb") as handle:
                archive.writestr(info, handle.read())
PYZIP

SIZE=$(du -h "$BUILD/lambda.zip" | cut -f1)
echo "✓ $BUILD/lambda.zip ($SIZE)"
