# SMT Exclusion Proof

Noir circuit that proves a Solana pubkey is **NOT** in a blacklist stored as a Sparse Merkle Tree. Verifiable on-chain via Groth16.

## Circuit

**Public inputs:**
- `smt_root` - Merkle root of the blacklist tree
- `pubkey_hash` - Poseidon2 hash of the pubkey being checked

**Private inputs:**
- `pubkey` - 32-byte Solana pubkey
- `siblings` - 254 sibling hashes (merkle path)
- `leaf_value` - Value at leaf position (must be 0 for exclusion)

## Build

```bash
# Compile circuit
nargo compile

# Run tests
nargo test

# Generate witness
nargo execute

# Sunspot pipeline (Groth16 for Solana)

# 1. Convert ACIR → Gnark constraint system
sunspot compile target/circuit_smt_exclusion.json

# 2. Trusted setup - generates proving key (.pk) and verifying key (.vk)
sunspot setup target/circuit_smt_exclusion.ccs

# 3. Generate Groth16 proof from witness
sunspot prove target/circuit_smt_exclusion.json target/circuit_smt_exclusion.gz target/circuit_smt_exclusion.ccs target/circuit_smt_exclusion.pk

# 4. Verify proof locally (optional, for debugging)
sunspot verify target/circuit_smt_exclusion.vk target/circuit_smt_exclusion.proof target/circuit_smt_exclusion.pw

# 5. Build Solana verifier program with VK embedded
sunspot deploy target/circuit_smt_exclusion.vk
```

## Deploy

```bash
solana program deploy target/circuit_smt_exclusion.so --url devnet
```

## Client

```bash
cd client
npm install

# Verify on-chain
npm run verify

# Integration test with SOL transfers
npm run test-transfer
```

## Files

```
src/main.nr          # Circuit
Prover.toml          # Test inputs
target/
  *.json             # Compiled ACIR
  *.gz               # Witness
  *.ccs              # Gnark constraint system
  *.pk / *.vk        # Proving/verifying keys
  *.proof / *.pw     # Proof + public witness
  *.so               # Solana verifier program
client/
  smt.ts             # TypeScript SMT (Poseidon2)
  proof.helper.ts    # Proof generation utilities
  verify.ts          # On-chain verification
  test-transfer.ts   # Integration test with SOL transfers
```

## SMT Usage (TypeScript)

```typescript
import { SparseMerkleTree, pubkeyToBytes } from "./smt.js";

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
