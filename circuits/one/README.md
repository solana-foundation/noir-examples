# Simple Assertion Circuit

A minimal Noir circuit demonstrating the full ZK pipeline from circuit to on-chain verification.

## What It Does

Proves that `x != y` without revealing the values. The simplest possible circuit for learning the Noir → Sunspot → Solana workflow.

## Quick Start

```bash
# From repo root
just test-one        # Run circuit tests
just compile-one     # Compile circuit
just prove-one       # Generate proof
just verify-one      # Verify proof on-chain
```

## Manual Steps

```bash
# Compile and execute
nargo compile
nargo execute

# Sunspot pipeline
sunspot compile target/circuit_one.json
sunspot setup target/circuit_one.ccs
sunspot prove target/circuit_one.json target/circuit_one.gz target/circuit_one.ccs target/circuit_one.pk

# Deploy and verify
sunspot deploy target/circuit_one.vk
solana program deploy target/circuit_one.so

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

