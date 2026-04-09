#!/bin/bash
# Upload all optimized portfolio images to R2 bucket
# Usage: ./scripts/upload-to-r2.sh

set -e

BUCKET="photography-private"
SOURCE_DIR="project-rga/optimized"
COUNT=0
TOTAL=$(find "$SOURCE_DIR" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" \) | wc -l | tr -d ' ')

echo "Uploading $TOTAL images to R2 bucket: $BUCKET"
echo "Source: $SOURCE_DIR"
echo "---"

find "$SOURCE_DIR" -type f \( -name "*.jpg" -o -name "*.JPG" -o -name "*.jpeg" -o -name "*.png" -o -name "*.webp" \) | sort | while read -r file; do
  # The R2 key is: project-rga/optimized/landscapes/RGA02744-640.jpg
  r2_key="$file"
  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL] $r2_key"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file "$file" --content-type "image/jpeg" 2>&1 | grep -v "^$"
done

echo "---"
echo "Done! All $TOTAL images uploaded to $BUCKET."
