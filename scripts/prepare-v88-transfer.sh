#!/usr/bin/env bash
set -euo pipefail
dir="/opt/sites/.ibex-v88-transfer"
umask 077
mkdir -p "$dir"
if [[ ! -f "$dir/private.pem" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$dir/private.pem" 2>/dev/null
fi
echo "[v88-transfer-public-key]"
openssl pkey -in "$dir/private.pem" -pubout 2>/dev/null
echo "[/v88-transfer-public-key]"
