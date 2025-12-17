# ECDSA Signature Verification Circuit

Noir circuit that verifies an ECDSA secp256k1 signature without revealing the public key.

## Circuit

**Public inputs:**
- `hashed_message` - SHA256 hash of the signed message (32 bytes)

**Private inputs:**
- `public_key_x` - X coordinate of the signing public key (32 bytes)
- `public_key_y` - Y coordinate of the signing public key (32 bytes)
- `signature` - ECDSA signature (64 bytes, r||s format)

**What it proves:**
- "I know a valid signature for this message"
- Without revealing which public key signed it

## Build

```bash
# Compile circuit
nargo compile

# Run tests
nargo test

# Generate witness
nargo execute

# Full Sunspot pipeline (Groth16)
sunspot compile target/circuit_verify_signer.json
sunspot setup target/circuit_verify_signer.ccs
sunspot prove target/circuit_verify_signer.json target/circuit_verify_signer.gz \
        target/circuit_verify_signer.ccs target/circuit_verify_signer.pk
```

## Generate Test Values

The included Python script generates fresh ECDSA keypairs and signatures:

```bash
# Requires: pip install ecdsa
python3 generate_prover_values.py
```

This outputs Noir-formatted arrays you can paste into `Prover.toml`.

## Files

```
src/main.nr                 # Circuit using std::ecdsa_secp256k1
Prover.toml                 # Test inputs (signature + pubkey + message)
generate_prover_values.py   # Python script to generate test values
```

## Use Cases

- **Anonymous voting**: Prove you're an authorized voter without revealing identity
- **Ring signatures**: Prove membership in a group without revealing which member
- **Privacy-preserving authentication**: Prove you have valid credentials without linking actions
