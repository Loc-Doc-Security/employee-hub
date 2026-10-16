#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TAG="${1:-v1}"
REGISTRY="${ECR_REGISTRY:-323643917694.dkr.ecr.us-east-1.amazonaws.com}"
REPO="${ECR_REPO:-employee-hub}"
REGION="${AWS_REGION:-us-east-1}"
IMAGE="${REGISTRY}/${REPO}:${TAG}"
LOCAL_TAG="employee-hub:${TAG}"
echo "==> Building Employee Hub for ECR (${REPO})..."
npm ci && npm run build
for f in dist/index.html dist-server/server.mjs server/data/initial-seed.production.json dist/lab-logo.png; do
  [[ -f "$f" ]] || { echo "error: missing $f" >&2; exit 1; }
done
grep -q '/src/main.tsx' dist/index.html && { echo "error: vite build failed" >&2; exit 1; }
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --platform linux/amd64 --build-arg "BUILD_ID=$(date +%s)" -f Dockerfile.ecs -t "$LOCAL_TAG" -t "$IMAGE" .
docker push "$IMAGE"
echo "Done: ${IMAGE}"