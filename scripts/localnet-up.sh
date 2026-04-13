#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${STELLAR_LOCALNET_CONTAINER:-stellar-localnet}"
IMAGE="${STELLAR_LOCALNET_IMAGE:-stellar/quickstart:testing}"

echo "Starting Stellar localnet container: ${CONTAINER_NAME}"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p 8000:8000 \
  -p 11626:11626 \
  "${IMAGE}" \
  --standalone \
  --enable rpc,horizon

echo "Localnet started."
echo "RPC:     http://localhost:8000/soroban/rpc"
echo "Horizon: http://localhost:8000"
