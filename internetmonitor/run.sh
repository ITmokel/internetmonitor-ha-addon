#!/usr/bin/env bash
set -e

mkdir -p /data

echo "Starting Internet Monitor..."
exec node /app/src/index.js
