#!/bin/sh
# Generates self-signed TLS material + the hash-chain signing key for LOCAL
# DEVELOPMENT ONLY. Production certificates come from the platform PKI and
# the signing key from an HSM (see docs/SECRETS.md).
set -eu

mkdir -p certs secrets

if [ ! -f certs/privkey.pem ]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
    -keyout certs/privkey.pem -out certs/fullchain.pem \
    -subj "/CN=localhost/O=SURF Security Companion Dev" \
    -addext "subjectAltName=DNS:localhost,DNS:keycloak.local,DNS:opensearch.local,IP:127.0.0.1"
  cp certs/fullchain.pem certs/opensearch-ca.pem
  echo "wrote certs/{privkey,fullchain,opensearch-ca}.pem"
else
  echo "certs already exist, skipping"
fi

if [ ! -f secrets/hashchain-ed25519.key ]; then
  # 32 random bytes, hex encoded — the FileEd25519Signer format
  openssl rand -hex 32 > secrets/hashchain-ed25519.key
  chmod 600 secrets/hashchain-ed25519.key
  echo "wrote secrets/hashchain-ed25519.key (dev soft key)"
else
  echo "signing key already exists, skipping"
fi
