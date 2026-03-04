#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

process_dir() {
  local source_dir="$1"
  local target_dir="$2"
  local quality="$3"

  mkdir -p "$target_dir"

  shopt -s nullglob
  for src in "$source_dir"/*.jpg; do
    local name
    name="$(basename "$src" .jpg)"

    for width in 640 1200 1800; do
      sips -s format jpeg -s formatOptions "$quality" -Z "$width" \
        "$src" --out "$target_dir/${name}-${width}.jpg" >/dev/null
    done
  done
  shopt -u nullglob
}

process_dir \
  "$ROOT_DIR/project-rga/landscapes" \
  "$ROOT_DIR/project-rga/optimized/landscapes" \
  "72"

process_dir \
  "$ROOT_DIR/project-rga/potraits/baby" \
  "$ROOT_DIR/project-rga/optimized/potraits/baby" \
  "70"

process_dir \
  "$ROOT_DIR/project-rga/potraits/potraits" \
  "$ROOT_DIR/project-rga/optimized/potraits/potraits" \
  "70"

process_dir \
  "$ROOT_DIR/project-rga/potraits/events" \
  "$ROOT_DIR/project-rga/optimized/potraits/events" \
  "70"

echo "Optimized variants generated in project-rga/optimized"
