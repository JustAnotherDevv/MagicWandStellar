#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${STELLAR_LOCALNET_CONTAINER:-stellar-localnet}"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
echo "Localnet container stopped: ${CONTAINER_NAME}"
