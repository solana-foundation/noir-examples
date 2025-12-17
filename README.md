# Solana Noir Examples

Zero-knowledge proof circuits written in [Noir](https://noir-lang.org/) with on-chain verification on [Solana](https://solana.com/) using [Groth16](https://eprint.iacr.org/2016/260) via [Sunspot](https://github.com/reilabs/sunspot).

## Circuits

| Circuit | Description | Proof Size |
|---------|-------------|------------|
| [one](./circuits/one/) | Simple assertion (`x != y`) | 324-388 bytes |
| [verify_signer](./circuits/verify_signer/) | ECDSA secp256k1 signature verification | ~388 bytes |
| [smt_exclusion](./circuits/smt_exclusion/) | Sparse Merkle Tree blacklist exclusion proof | 388 bytes |

## Prerequisites

- [Nargo](https://noir-lang.org/docs/getting_started/installation/) `1.0.0-beta.13`
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
mkdir -p circuits/one/keypair circuits/smt_exclusion/keypair

# Generate deployer keypairs
solana-keygen new --outfile circuits/one/keypair/deployer.json
solana-keygen new --outfile circuits/smt_exclusion/keypair/deployer.json

# Fund on devnet
solana airdrop 2 $(solana-keygen pubkey circuits/one/keypair/deployer.json) --url devnet
solana airdrop 2 $(solana-keygen pubkey circuits/smt_exclusion/keypair/deployer.json) --url devnet
```

> **Warning:** Never commit keypair files. They are excluded via `.gitignore`.

## Quick Start

```bash
# Test all circuits
just test-all

# Compile all circuits
just compile-all

# Install all dependencies
just install-all

# See all available commands
just --list
```

## Pipeline Overview

Each circuit follows the same workflow:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Noir      │    │   Sunspot   │    │   Sunspot   │    │   Solana    │
│   Circuit   │───▶│   Compile   │───▶│   Prove     │───▶│   Verify    │
│  (main.nr)  │    │   (.ccs)    │    │  (.proof)   │    │   (.so)     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

1. **Write circuit** in Noir (`src/main.nr`)
2. **Compile** with `nargo compile` → ACIR bytecode
3. **Execute** with `nargo execute` → witness
4. **Convert** with `sunspot compile` → Gnark constraint system
5. **Setup** with `sunspot setup` → proving/verifying keys
6. **Prove** with `sunspot prove` → Groth16 proof
7. **Deploy** with `sunspot deploy` → Solana verifier program
8. **Verify** on-chain by sending proof as transaction data

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
