# Noir Circuits - Build, Test, and Demo Commands
# Run `just --list` to see all available commands

# Default: list available commands
default:
    @just --list

# ============================================================================
# All Circuits
# ============================================================================

# Test all circuits
test-all: test-one test-signer test-smt

# Compile all circuits
compile-all: compile-one compile-signer compile-smt

# Install all client dependencies
install-all: install-lib install-one install-signer install-smt

# Install shared lib dependencies
install-lib:
    cd lib && npm install

# ============================================================================
# circuits/one (simple assert x != y)
# ============================================================================

# Compile one
compile-one:
    cd circuits/one && nargo compile

# Test one
test-one:
    cd circuits/one && nargo test

# Generate witness for one
execute-one:
    cd circuits/one && nargo execute

# Verify proof on-chain (requires deployed verifier program)
verify-one x="1" y="2":
    cd circuits/one/client && npm run verify -- {{x}} {{y}}
    git checkout circuits/one/Prover.toml 2>/dev/null || true

# Install client dependencies
install-one:
    cd circuits/one/client && npm install

# Full Sunspot pipeline for one
prove-one: compile-one execute-one
    cd circuits/one && sunspot compile target/one.json
    cd circuits/one && sunspot setup target/one.ccs
    cd circuits/one && sunspot prove target/one.json target/one.gz target/one.ccs target/one.pk

# Build Solana verifier for one
build-verifier-one:
    cd circuits/one && sunspot deploy target/one.vk

# ============================================================================
# circuits/verify_signer (ECDSA signature verification)
# ============================================================================

# Compile verify_signer
compile-signer:
    cd circuits/verify_signer && nargo compile

# Test verify_signer
test-signer:
    cd circuits/verify_signer && nargo test

# Generate witness for verify_signer
execute-signer:
    cd circuits/verify_signer && nargo execute

# Generate new test values (requires: pip install ecdsa)
gen-signer-values:
    cd circuits/verify_signer && python3 generate_prover_values.py

# Install client dependencies
install-signer:
    cd circuits/verify_signer/client && npm install

# Verify proof on-chain (requires deployed verifier program)
verify-signer program_id:
    cd circuits/verify_signer/client && npm run verify -- --program {{program_id}}
    git checkout circuits/verify_signer/Prover.toml 2>/dev/null || true

# Full Sunspot pipeline for verify_signer
prove-signer: compile-signer execute-signer
    cd circuits/verify_signer && sunspot compile target/verify_signer.json
    cd circuits/verify_signer && sunspot setup target/verify_signer.ccs
    cd circuits/verify_signer && sunspot prove target/verify_signer.json target/verify_signer.gz target/verify_signer.ccs target/verify_signer.pk

# Build Solana verifier for verify_signer
build-verifier-signer:
    cd circuits/verify_signer && sunspot deploy target/verify_signer.vk

# ============================================================================
# circuits/smt_exclusion (SMT blacklist exclusion proof)
# ============================================================================

# Compile smt_exclusion
compile-smt:
    cd circuits/smt_exclusion && nargo compile

# Test smt_exclusion
test-smt:
    cd circuits/smt_exclusion && nargo test

# Generate witness for smt_exclusion
execute-smt:
    cd circuits/smt_exclusion && nargo execute

# Verify proof on-chain (requires deployed verifier program)
verify-smt program_id="HEYDMuVw8sLE4tt5cnvu9iwMQMSWB16P1ezUx6sctepP":
    cd circuits/smt_exclusion/client && npm run verify -- --program {{program_id}}
    git checkout circuits/smt_exclusion/Prover.toml 2>/dev/null || true

# Integration test: verify proof + SOL transfer (requires deployed programs)
test-transfer-smt:
    cd circuits/smt_exclusion/client && npm run test-transfer
    git checkout circuits/smt_exclusion/Prover.toml 2>/dev/null || true

# Install client dependencies
install-smt:
    cd circuits/smt_exclusion/client && npm install

# Full Sunspot pipeline for smt_exclusion
prove-smt: compile-smt execute-smt
    cd circuits/smt_exclusion && sunspot compile target/smt_exclusion.json
    cd circuits/smt_exclusion && sunspot setup target/smt_exclusion.ccs
    cd circuits/smt_exclusion && sunspot prove target/smt_exclusion.json target/smt_exclusion.gz target/smt_exclusion.ccs target/smt_exclusion.pk

# Build Solana verifier for smt_exclusion
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

# Check nargo version
version:
    nargo --version
    sunspot --version || echo "sunspot not installed"
