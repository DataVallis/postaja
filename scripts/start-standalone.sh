#!/usr/bin/env sh
# Runs the production standalone server exactly as the Docker image does (used by E2E).
set -e
cp -r public .next/standalone/ 2>/dev/null || true
mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/
cp -r drizzle assets .next/standalone/
cd .next/standalone && exec node server.js
