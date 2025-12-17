# ECDSA Signature Verification Circuit

Noir circuit that verifies an ECDSA secp256k1 signature without revealing the public key.

## Circuit

**Public inputs:**
- `message_commitment` - Poseidon hash of the message (1 Field element)

**Private inputs:**
- `hashed_message` - SHA256 hash of the signed message (32 bytes)
- `public_key_x` - X coordinate of the signing public key (32 bytes)
- `public_key_y` - Y coordinate of the signing public key (32 bytes)
- `signature` - ECDSA signature (64 bytes, r||s format)

**What it proves:**
- "I know a valid signature for a message with this commitment"
- Without revealing which public key signed it

**How verification works:**
1. On-chain: Verifier sees `message_commitment` (32 bytes)
2. Off-chain: Prover shares `hashed_message` with verifier
3. Verifier computes `poseidon(hashed_message)` and checks it matches `message_commitment`

This approach reduces the public witness from ~1KB to 44 bytes, fitting within Solana's transaction size limits.

## Quick Start

```bash
# From repo root
just install-signer           # Install client dependencies
just test-signer              # Run circuit tests
just prove-signer             # Compile + execute + generate proof
just build-verifier-signer    # Build Solana verifier (.so)

# Deploy verifier to Solana devnet (manual step)
solana program deploy circuits/verify_signer/target/verify_signer.so \
  --keypair circuits/verify_signer/keypair/deployer.json \
  --program-id circuits/verify_signer/target/verify_signer-keypair.json \
  --url devnet

# Verify proof on-chain (pass the deployed program ID)
just verify-signer <PROGRAM_ID>
```

## Manual Steps

```bash
# Compile and execute
nargo compile
nargo execute

# Sunspot pipeline
sunspot compile target/verify_signer.json
sunspot setup target/verify_signer.ccs
sunspot prove target/verify_signer.json target/verify_signer.gz \
  target/verify_signer.ccs target/verify_signer.pk

# Build and deploy verifier
sunspot deploy target/verify_signer.vk
solana program deploy target/verify_signer.so

# Test client
cd client && npm install
npm run verify -- --program <PROGRAM_ID>
npm run verify -- --program <PROGRAM_ID> --corrupt  # Test rejection
```

## Generate Test Values

The included Python script generates fresh ECDSA keypairs and signatures:

```bash
# Requires: pip install ecdsa
python3 generate_prover_values.py
# Or use: just gen-signer-values
```

This outputs Noir-formatted arrays you can paste into `Prover.toml`.

## Files

| File | Description |
|------|-------------|
| `src/main.nr` | Circuit using ECDSA + Poseidon commitment |
| `Prover.toml` | Test inputs (signature + pubkey + message + commitment) |
| `generate_prover_values.py` | Python script to generate test values |
| `client/` | TypeScript verification client |

## Dependencies

- `poseidon` - Circom-compatible Poseidon hash (noir-lang/poseidon)

## Use Cases

- **Anonymous voting**: Prove you're an authorized voter without revealing identity
- **Ring signatures**: Prove membership in a group without revealing which member
- **Privacy-preserving authentication**: Prove you have valid credentials without linking actions
