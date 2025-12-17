# Simple Assertion Circuit

A minimal Noir circuit demonstrating the full ZK pipeline from circuit to on-chain verification.

## What It Does

Proves that `x != y` without revealing the values. The simplest possible circuit for learning the Noir → Sunspot → Solana workflow.

## Quick Start

```bash
# From repo root
just install-one        # Install client dependencies
just test-one           # Run circuit tests
just prove-one          # Compile + execute + generate proof
just build-verifier-one # Build Solana verifier (.so)

# Deploy verifier to Solana devnet (manual step)
solana program deploy circuits/one/target/one.so \
  --keypair circuits/one/keypair/deployer.json \
  --program-id circuits/one/target/circuit_one-keypair.json \
  --url devnet

# Update PROGRAM_ID in client/verify.ts with the deployed address, then:
just verify-one         # Verify proof on-chain
```

## Manual Steps

```bash
# Compile and execute
nargo compile
nargo execute

# Sunspot pipeline
sunspot compile target/one.json
sunspot setup target/one.ccs
sunspot prove target/one.json target/one.gz target/one.ccs target/one.pk

# Build and deploy verifier
sunspot deploy target/one.vk
solana program deploy target/one.so

# Test client
cd client && npm install
npm run verify -- 42 100
npm run verify -- 42 100 --corrupt  # Test rejection
```

## Files

| File | Description |
|------|-------------|
| `src/main.nr` | Circuit code |
| `Prover.toml` | Test inputs |
| `client/` | TypeScript verification client |

