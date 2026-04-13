#!/usr/bin/env bash
set -euo pipefail

NETWORK_NAME="${1:-local}"
IDENTITY_NAME="${2:-alice}"
PASSPHRASE="Standalone Network ; February 2017"
RPC_URL="http://localhost:8000/soroban/rpc"
FRIENDBOT_URL="http://localhost:8000/friendbot"
HORIZON_URL="http://localhost:8000/"

wait_for_horizon() {
  local max_wait_s="${1:-60}"
  local elapsed=0
  until curl -fsS "${HORIZON_URL}" >/dev/null 2>&1; do
    if [ "${elapsed}" -ge "${max_wait_s}" ]; then
      echo "Horizon not ready after ${max_wait_s}s at ${HORIZON_URL}" >&2
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
}

fund_with_retry() {
  local addr="$1"
  local attempts=0
  local max_attempts=12
  local delay_s=2
  while true; do
    local resp
    resp="$(curl -sS -w $'\n%{http_code}' "${FRIENDBOT_URL}?addr=${addr}" || true)"
    local code
    code="$(printf '%s' "${resp}" | tail -n 1)"
    local body
    body="$(printf '%s' "${resp}" | sed '$d')"

    if [ "${code}" = "200" ]; then
      return 0
    fi
    if [ "${code}" = "400" ] && printf '%s' "${body}" | rg -qi "already funded|already exists"; then
      echo "Friendbot: account already funded; continuing."
      return 0
    fi
    attempts=$((attempts + 1))
    if [ "${attempts}" -ge "${max_attempts}" ]; then
      echo "Friendbot funding failed after ${max_attempts} attempts for ${addr}" >&2
      return 1
    fi
    sleep "${delay_s}"
  done
}

echo "Configuring network '${NETWORK_NAME}'..."
stellar network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true
stellar network add "${NETWORK_NAME}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}"

echo "Configuring identity '${IDENTITY_NAME}'..."
if ! stellar keys ls | rg -q "^${IDENTITY_NAME}$"; then
  stellar keys generate "${IDENTITY_NAME}" --network "${NETWORK_NAME}"
fi

ADDR="$(stellar keys address "${IDENTITY_NAME}")"
echo "Waiting for local Horizon/Friendbot..."
wait_for_horizon 60
echo "Funding ${ADDR} via local friendbot..."
fund_with_retry "${ADDR}"

echo "Done."
echo "Identity: ${IDENTITY_NAME}"
echo "Address:  ${ADDR}"
