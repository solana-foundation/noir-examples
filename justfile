# Noir Circuits - Build, Test, and Demo Commands
# Run `just --list` to see all available commands

# Default: list available commands
default:
    @just --list

# ============================================================================
# Quick Start (run in order for first-time setup)
# ============================================================================
# 1. just install-all       - Install dependencies
# 2. just test-all          - Run circuit unit tests
# 3. just verify-all        - Verify proofs on-chain (uses pre-deployed verifiers)
# 4. just test-transfer-smt - Integration test: ZK-gated SOL transfer

# Install all dependencies (run this first!)
install-all: install-lib install-one install-signer install-smt

# Install shared lib dependencies
install-lib:
    cd lib && pnpm install

# Test all circuits (nargo test)
test-all: test-one test-signer test-smt

# Compile all circuits
compile-all: compile-one compile-signer compile-smt

# Generate proofs for all circuits (uses existing keys)
prove-all: prove-one prove-signer prove-smt

# Verify all proofs on-chain (requires deployed verifiers)
verify-all: verify-one verify-signer verify-smt

# Run all integration tests (requires deployed programs)
integration-test-all: verify-all test-transfer-smt

# ============================================================================
# circuits/one (simple assert x != y)
# ============================================================================

# Install client dependencies
install-one:
    cd circuits/one/client && pnpm install

# Compile circuit
compile-one:
    cd circuits/one && nargo compile

# Run circuit tests
test-one:
    cd circuits/one && nargo test

# Generate witness
execute-one:
    cd circuits/one && nargo execute

# Generate proof (uses existing ACIR/pk/ccs from repo)
prove-one: execute-one
    cd circuits/one && sunspot prove target/one.json target/one.gz target/one.ccs target/one.pk

# Verify proof on-chain (requires deployed verifier program)
verify-one x="1" y="2":
    cd circuits/one/client && pnpm run verify -- {{x}} {{y}}
    git checkout circuits/one/Prover.toml 2>/dev/null || true

# Full Sunspot setup (regenerates keys - only needed if circuit changes)
setup-one: compile-one execute-one
    cd circuits/one && sunspot compile target/one.json
    cd circuits/one && sunspot setup target/one.ccs
    cd circuits/one && sunspot prove target/one.json target/one.gz target/one.ccs target/one.pk

# Build Solana verifier program
build-verifier-one:
    cd circuits/one && sunspot deploy target/one.vk

# ============================================================================
# circuits/verify_signer (ECDSA signature verification)
# ============================================================================

# Install client dependencies
install-signer:
    cd circuits/verify_signer/client && pnpm install

# Compile circuit
compile-signer:
    cd circuits/verify_signer && nargo compile

# Run circuit tests
test-signer:
    cd circuits/verify_signer && nargo test

# Generate witness
execute-signer:
    cd circuits/verify_signer && nargo execute

# Generate new test values (requires: pip install ecdsa)
gen-signer-values:
    cd circuits/verify_signer && python3 generate_prover_values.py

# Generate proof (uses existing ACIR/pk/ccs from repo)
prove-signer: execute-signer
    cd circuits/verify_signer && sunspot prove target/verify_signer.json target/verify_signer.gz target/verify_signer.ccs target/verify_signer.pk

# Verify proof on-chain (requires deployed verifier program)
verify-signer program_id="7uatSejNcJvmp8G19F6F54uyzLkkMYnEgD58pFTTuW1A":
    cd circuits/verify_signer/client && pnpm run verify -- --program {{program_id}}
    git checkout circuits/verify_signer/Prover.toml 2>/dev/null || true

# Full Sunspot setup (regenerates keys - only needed if circuit changes)
setup-signer: compile-signer execute-signer
    cd circuits/verify_signer && sunspot compile target/verify_signer.json
    cd circuits/verify_signer && sunspot setup target/verify_signer.ccs
    cd circuits/verify_signer && sunspot prove target/verify_signer.json target/verify_signer.gz target/verify_signer.ccs target/verify_signer.pk

# Build Solana verifier program
build-verifier-signer:
    cd circuits/verify_signer && sunspot deploy target/verify_signer.vk

# ============================================================================
# circuits/smt_exclusion (SMT blacklist exclusion proof)
# ============================================================================

# Install client dependencies
install-smt:
    cd circuits/smt_exclusion/client && pnpm install

# Compile circuit
compile-smt:
    cd circuits/smt_exclusion && nargo compile

# Run circuit tests
test-smt:
    cd circuits/smt_exclusion && nargo test

# Generate witness
execute-smt:
    cd circuits/smt_exclusion && nargo execute

# Generate proof (uses existing ACIR/pk/ccs from repo)
prove-smt: execute-smt
    cd circuits/smt_exclusion && sunspot prove target/smt_exclusion.json target/smt_exclusion.gz target/smt_exclusion.ccs target/smt_exclusion.pk

# Verify proof on-chain (requires deployed verifier program)
verify-smt program_id="548u4SFWZMaRWZQqdyAgm66z7VRYtNHHF2sr7JTBXbwN":
    cd circuits/smt_exclusion/client && pnpm run verify -- --program {{program_id}}
    git checkout circuits/smt_exclusion/Prover.toml 2>/dev/null || true

# Integration test: verify proof + SOL transfer (requires deployed programs)
test-transfer-smt:
    cd circuits/smt_exclusion/client && pnpm run test-transfer
    git checkout circuits/smt_exclusion/Prover.toml 2>/dev/null || true

# Full Sunspot setup (regenerates keys - only needed if circuit changes)
setup-smt: compile-smt execute-smt
    cd circuits/smt_exclusion && sunspot compile target/smt_exclusion.json
    cd circuits/smt_exclusion && sunspot setup target/smt_exclusion.ccs
    cd circuits/smt_exclusion && sunspot prove target/smt_exclusion.json target/smt_exclusion.gz target/smt_exclusion.ccs target/smt_exclusion.pk

# Build Solana verifier program
build-verifier-smt:
    cd circuits/smt_exclusion && sunspot deploy target/smt_exclusion.vk

# ============================================================================
# Utility Commands
# ============================================================================

# Format all code (Noir + Rust + TypeScript)
fmt:
    cd circuits/one && nargo fmt
    cd circuits/verify_signer && nargo fmt
    cd circuits/smt_exclusion && nargo fmt
    cd circuits/smt_exclusion/on_chain_program && cargo fmt
    cd lib && npx prettier --write "../**/*.ts"

# Check formatting
fmt-check:
    cd circuits/one && nargo fmt --check
    cd circuits/verify_signer && nargo fmt --check
    cd circuits/smt_exclusion && nargo fmt --check
    cd circuits/smt_exclusion/on_chain_program && cargo fmt --check
    cd lib && npx prettier --check "../**/*.ts"

# Check nargo/sunspot versions
version:
    nargo --version
    sunspot --version || echo "sunspot not installed"
