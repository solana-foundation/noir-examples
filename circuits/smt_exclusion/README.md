# SMT Exclusion Proof

Noir circuit that proves a Solana pubkey is **NOT** in a blacklist stored as a Sparse Merkle Tree. Verifiable on-chain via Groth16.

## Circuit

**Public inputs:**
- `smt_root` - Merkle root of the blacklist tree
- `pubkey_hash` - Poseidon hash of the pubkey being checked

**Private inputs:**
- `pubkey` - 32-byte Solana pubkey
- `siblings` - 254 sibling hashes (merkle path)
- `leaf_value` - Value at leaf position (must be 0 for exclusion)

**What it proves:**
- "My pubkey is NOT in the blacklist"
- Without revealing which pubkey

## Quick Start

```bash
# From repo root
just install-smt           # Install client dependencies
just test-smt              # Run circuit tests
just prove-smt             # Compile + execute + generate proof
just build-verifier-smt    # Build Solana verifier (.so)

# Deploy verifier to Solana devnet (manual step)
solana program deploy circuits/smt_exclusion/target/smt_exclusion.so \
  --keypair circuits/smt_exclusion/keypair/deployer.json \
  --program-id circuits/smt_exclusion/target/smt_exclusion-keypair.json \
  --url devnet

# Verify proof on-chain
just verify-smt <PROGRAM_ID>

# Integration test with SOL transfers
just test-transfer-smt
```

## Manual Steps

```bash
# Compile and execute
nargo compile
nargo execute

# Sunspot pipeline
sunspot compile target/smt_exclusion.json
sunspot setup target/smt_exclusion.ccs
sunspot prove target/smt_exclusion.json target/smt_exclusion.gz \
  target/smt_exclusion.ccs target/smt_exclusion.pk

# Build and deploy verifier
sunspot deploy target/smt_exclusion.vk
solana program deploy target/smt_exclusion.so

# Test client
cd client && npm install
npm run verify -- --program <PROGRAM_ID>
npm run test-transfer  # Integration test with SOL transfers
```

## Files

| File | Description |
|------|-------------|
| `src/main.nr` | Circuit (SMT exclusion proof) |
| `Prover.toml` | Test inputs |
| `client/smt.ts` | TypeScript SMT implementation |
| `client/verify.ts` | On-chain verification client |
| `client/test-transfer.ts` | Integration test with SOL transfers |
| `on_chain_program/` | Rust program for gated transfers |

## Dependencies

- `poseidon` - Circom-compatible Poseidon hash (noir-lang/poseidon)

## SMT Usage (TypeScript)

```typescript
import { SparseMerkleTree, pubkeyToBytes, initPoseidon } from "./smt.js";

await initPoseidon();
const smt = new SparseMerkleTree();

// Add to blacklist
const blacklistedKey = pubkeyToBytes("FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH");
smt.insert(blacklistedKey, 1n);

// Check status
smt.isBlacklisted(blacklistedKey);  // true

// Generate proof inputs
const { siblings, leafValue } = smt.getMerkleProof(blacklistedKey);
const root = smt.getRoot();
```

## Proof Sizes

| Component | Size |
|-----------|------|
| Proof | 388 bytes |
| Public witness | 76 bytes |
| Total tx data | 464 bytes |

## Use Cases

- **Sanctions compliance**: Prove you're not on a blacklist without revealing identity
- **Access control**: Prove you're not banned from a service
- **Privacy-preserving KYC**: Prove you passed checks without revealing details
