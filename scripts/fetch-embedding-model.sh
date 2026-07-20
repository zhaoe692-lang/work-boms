#!/usr/bin/env bash
# Download the local semantic-search ONNX weights (not stored in git).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/src-tauri/resources/models/bge-small-zh-v1.5-int8"
DEST_FILE="$DEST_DIR/model_int8.onnx"
EXPECTED_SHA256="b9837c19ce154ff0726d398ee77abbc03a7faf0476c6f93016c84e531be7ebb5"
URL="https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/75c43b0/onnx/model_int8.onnx"

mkdir -p "$DEST_DIR"

if [[ -f "$DEST_FILE" ]]; then
  ACTUAL="$(shasum -a 256 "$DEST_FILE" | awk '{print $1}')"
  if [[ "$ACTUAL" == "$EXPECTED_SHA256" ]]; then
    echo "Embedding model already present: $DEST_FILE"
    exit 0
  fi
  echo "Existing file has unexpected checksum; re-downloading…"
  rm -f "$DEST_FILE"
fi

echo "Downloading embedding model → $DEST_FILE"
TMP="$DEST_FILE.partial"
curl -fL --retry 3 --retry-delay 2 -o "$TMP" "$URL"
ACTUAL="$(shasum -a 256 "$TMP" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED_SHA256" ]]; then
  rm -f "$TMP"
  echo "Checksum mismatch. expected=$EXPECTED_SHA256 actual=$ACTUAL" >&2
  exit 1
fi
mv "$TMP" "$DEST_FILE"
echo "Done. See $DEST_DIR/MODEL_LICENSE.md for license info."
