# Solana Noir Examples

Zero-knowledge proof circuits written in [Noir](https://noir-lang.org/) with on-chain verification on [Solana](https://solana.com/) using [Groth16](https://eprint.iacr.org/2016/260) via [Sunspot](https://github.com/reilabs/sunspot).

## What's a Circuit?

A circuit is a program that defines a computation you can *prove* you executed correctly—without revealing your private inputs. Think of it as a function where you can say "I know inputs that satisfy these constraints" and generate cryptographic proof, without exposing those inputs.

Jump to [Pipeline Overview](#pipeline-overview) to see how the circuits are built and verified.

## Example Circuits

This repo contains three example circuits:

| Circuit | Description | Proof Size | Devnet Verifier |
|---------|-------------|------------|-----------------|
| [one](./circuits/one/) | Simple assertion (`x != y`) | 324-388 bytes | Deployed |
| [verify_signer](./circuits/verify_signer/) | ECDSA secp256k1 signature verification | ~388 bytes | Deployed |
| [smt_exclusion](./circuits/smt_exclusion/) | Sparse Merkle Tree blacklist exclusion proof | 388 bytes | Deployed |

> **Note:** The `smt_exclusion` circuit also includes a custom [on-chain program](./circuits/smt_exclusion/on_chain_program/) that demonstrates CPI (cross-program invocation) to the ZK verifier.

## Prerequisites

- [Nargo](https://noir-lang.org/docs/getting_started/noir_installation) `1.0.0-beta.13`
- [Sunspot](https://github.com/reilabs/sunspot) (requires Go 1.24+)
- [Solana CLI](https://solana.com/docs/intro/installation)
- Node.js 18+ (for TypeScript clients)

```bash
# Install specific Noir version
noirup -v 1.0.0-beta.13

# Install Sunspot
git clone https://github.com/reilabs/sunspot.git ~/sunspot
cd ~/sunspot/go && go build -o sunspot .
export PATH="$HOME/sunspot/go:$PATH"
export GNARK_VERIFIER_BIN="$HOME/sunspot/gnark-solana/crates/verifier-bin"
```

## Wallet Setup

Each circuit requires a deployer keypair for on-chain verification. Generate one per circuit:

```bash
# Create keypair directories
mkdir -p circuits/one/keypair circuits/smt_exclusion/keypair circuits/verify_signer/keypair

# Generate deployer keypairs
solana-keygen new --outfile circuits/one/keypair/deployer.json --no-bip39-passphrase -s
solana-keygen new --outfile circuits/smt_exclusion/keypair/deployer.json --no-bip39-passphrase -s
solana-keygen new --outfile circuits/verify_signer/keypair/deployer.json --no-bip39-passphrase -s

# Fund on devnet
solana airdrop 2 $(solana address -k circuits/one/keypair/deployer.json) --url devnet
solana airdrop 2 $(solana address -k circuits/smt_exclusion/keypair/deployer.json) --url devnet
solana airdrop 2 $(solana address -k circuits/verify_signer/keypair/deployer.json) --url devnet
```

If you hit airdrop limits using Solana CLI, you can use the [Solana Faucet](https://faucet.solana.com/) to get more SOL.

> **Warning:** Never commit keypair files. They are excluded via `.gitignore`.

## Quick Start

```bash
# 1. Install all dependencies
just install-all

# 2. Run circuit unit tests
just test-all

# 3. Verify proofs on-chain (uses pre-deployed devnet verifiers)
just verify-all

# 4. Integration test: ZK-gated SOL transfer
just test-transfer-smt

# See all available commands
just --list
```

> **Note:** Steps 3-4 require a funded devnet wallet. See [Wallet Setup](#wallet-setup).

## Pipeline Overview

Each circuit follows the same workflow:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Noir      │    │   Sunspot   │    │   Sunspot   │    │   Solana    │
│   Circuit   │───▶│   Compile   │───▶│   Prove     │───▶│   Verify    │
│  (main.nr)  │    │   (.ccs)    │    │  (.proof)   │    │   (.so)     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### Noir (off-chain circuit development)

| Step | Command | Output | What it does |
|------|---------|--------|--------------|
| 1. Write | — | `src/main.nr` | Define your circuit logic in Noir |
| 2. Test | `nargo test` | — | Run unit tests locally (no proof generated) |
| 3. Compile | `nargo compile` | `target/<name>.json` | Convert Noir to ACIR bytecode |
| 4. Execute | `nargo execute` | `target/<name>.gz` | Run circuit with inputs to generate witness |

### Sunspot (proof generation & verifier creation)

| Step | Command | Output | What it does |
|------|---------|--------|--------------|
| 5. Convert | `sunspot compile` | `.ccs` | Transform ACIR to Gnark constraint system |
| 6. Setup | `sunspot setup` | `.pk`, `.vk` | Generate proving key and verifying key |
| 7. Prove | `sunspot prove` | `.proof`, `.pw` | Generate Groth16 proof from witness |
| 8. Build verifier | `sunspot deploy` | `verifier.so` | Create Solana program with VK baked in |

### Solana (on-chain verification)

| Step | Command | Output | What it does |
|------|---------|--------|--------------|
| 9. Deploy | `solana program deploy` | Program ID | Deploy verifier program to Solana |
| 10. Verify | `just verify-*` | Transaction | Send proof to verifier, succeeds if valid |

> **Clone & Verify:** This repo includes pre-generated proving artifacts (`.ccs`, `.pk`, `.vk`, `.json`) that match the deployed devnet verifiers. You can clone and run `just verify-all` immediately—no Sunspot setup required. To modify circuits or deploy your own verifier, run `just setup-*` to regenerate keys.

## Project Structure

```
├── lib/                          # Shared TypeScript utilities
│   ├── proof.ts                  # Proof generation pipeline
│   └── verify.ts                 # On-chain verification helpers
│
├── circuits/
│   ├── one/                      # Simple assertion circuit
│   │   ├── src/main.nr           # Circuit code
│   │   ├── Prover.toml           # Input values
│   │   └── client/               # TypeScript verification client
│   │
│   ├── verify_signer/            # ECDSA signature verification
│   │   ├── src/main.nr           # Circuit using std::ecdsa_secp256k1
│   │   ├── Prover.toml           # Test signature vectors
│   │   ├── client/               # TypeScript verification client
│   │   └── generate_prover_values.py
│   │
│   └── smt_exclusion/            # SMT blacklist exclusion proof
│       ├── src/main.nr           # Circuit with Poseidon hashing
│       ├── client/               # TypeScript SMT + verification
│       └── on_chain_program/     # Rust Solana program
│
├── justfile                      # Build/test commands
└── LICENSE                       # MIT License
```

## On-Chain Verification

Proofs are verified by sending a transaction with instruction data containing:

```
instruction_data = proof_bytes || public_witness_bytes
```

The verifier program (built by Sunspot) validates the Groth16 proof against the embedded verifying key.

## Resources

- [Noir Documentation](https://noir-lang.org/docs/)
- [Sunspot Repository](https://github.com/reilabs/sunspot)
- [Groth16 Paper](https://eprint.iacr.org/2016/260)

## License

[MIT](./LICENSE)
