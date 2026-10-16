#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TAG="${1:-v1}"
echo "==> ECR push..."
npm run build-ecr -- "$TAG"
if git rev-parse --git-dir >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  git push -u origin "${GIT_BRANCH:-main}" || true
fi
