#!/bin/sh
# Downloads the Salsa-dataset beat annotations (github.com/AntoninRap/Salsa-dataset) into
# tools/annotations/, which git ignores. tools/eval.mjs matches them to audio files by name.
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
git clone -q --depth 1 https://github.com/AntoninRap/Salsa-dataset "$tmp/sd"
mkdir -p "$dir/annotations"
cp "$tmp/sd/Regular tempo/"*.csv "$dir/annotations/"
echo "Annotations for $(ls "$dir/annotations" | wc -l | tr -d ' ') songs in tools/annotations/"
