// ============================================================================
// SMT Exclusion Proof Circuit
// ============================================================================
// Proves that a Solana pubkey is NOT in a blacklist (Sparse Merkle Tree).
//
// How it works:
// 1. Verifier publishes SMT root on-chain (commits to blacklist state)
// 2. User wants to prove their pubkey is NOT blacklisted
// 3. User provides merkle path to their leaf position
// 4. Circuit verifies: leaf is empty (0) AND path reconstructs to root
//
// If pubkey IS in tree: leaf != 0, proof generation fails
// If pubkey NOT in tree: leaf == 0, proof succeeds
// ============================================================================

use dep::poseidon::poseidon::bn254::hash_2 as poseidon_hash;

// Tree configuration
global TREE_DEPTH: u32 = 254; // Full BN254 field bits for collision resistance
global EMPTY_LEAF: Field = 0; // Empty leaf value (standard SMT convention)

// ============================================================================
// Hash Functions
// ============================================================================

/// Poseidon hash of two Field elements (Circom-compatible, used for merkle tree nodes)
fn poseidon_hash_2(left: Field, right: Field) -> Field {
    poseidon_hash([left, right])
}

/// Convert 16 bytes to Field (little-endian)
/// Used to split 32-byte pubkey into two halves for hashing
fn bytes16_to_field(bytes: [u8; 32], start: u32) -> Field {
    let mut result: Field = 0;
    let mut multiplier: Field = 1;

    for i in 0..16 {
        result = result + (bytes[start + i] as Field) * multiplier;
        multiplier = multiplier * 256;
    }

    result
}

/// Hash a 32-byte Solana pubkey to a single Field element
/// This hash determines the leaf position in the SMT (the "index")
pub fn pubkey_to_index(pubkey: [u8; 32]) -> Field {
    let low = bytes16_to_field(pubkey, 0); // First 16 bytes
    let high = bytes16_to_field(pubkey, 16); // Last 16 bytes
    poseidon_hash_2(low, high)
}

// ============================================================================
// Merkle Tree
// ============================================================================

/// Compute merkle root from leaf + sibling path
///
/// Arguments:
/// - leaf: Value at the leaf position (0 for empty, non-zero for occupied)
/// - path_bits: Direction at each level (0=left, 1=right), derived from pubkey hash
/// - siblings: Sibling hashes at each level of the tree
fn compute_merkle_root<let N: u32>(leaf: Field, path_bits: [u1; N], siblings: [Field; N]) -> Field {
    let mut current = leaf;

    for i in 0..N {
        let sibling = siblings[i];
        let bit = path_bits[i];

        // Determine ordering based on path direction
        let (left, right) = if bit == 0 {
            (current, sibling) // We're the left child
        } else {
            (sibling, current) // We're the right child
        };

        current = poseidon_hash_2(left, right);
    }

    current
}

// ============================================================================
// Main Circuit
// ============================================================================

/// Prove that a pubkey is NOT in the SMT (exclusion proof)
///
/// Public inputs (on-chain, visible to verifier):
/// - smt_root: Merkle root of the blacklist tree
/// - pubkey_hash: Poseidon hash of the pubkey (Circom-compatible, verifier computes via sol_poseidon)
///
/// Private inputs (off-chain, hidden from verifier):
/// - pubkey: The actual 32-byte Solana pubkey
/// - siblings: 254 sibling hashes forming the merkle path
/// - leaf_value: Value at this pubkey's leaf position (must be 0)
fn main(
    smt_root: pub Field,
    pubkey_hash: pub Field,
    pubkey: [u8; 32],
    siblings: [Field; TREE_DEPTH],
    leaf_value: Field,
) {
    // 1. Verify pubkey matches public hash (binds proof to specific pubkey)
    let computed_hash = pubkey_to_index(pubkey);
    assert(computed_hash == pubkey_hash, "Pubkey hash mismatch");

    // 2. Derive path through tree from pubkey hash (254 bits)
    let path_bits: [u1; TREE_DEPTH] = computed_hash.to_le_bits();

    // 3. Verify leaf is empty - THIS IS THE EXCLUSION PROOF
    //    If leaf != 0, the pubkey is in the tree (blacklisted) and this fails
    assert(leaf_value == EMPTY_LEAF, "Exclusion failed: leaf is not empty");

    // 4. Verify merkle path reconstructs to the public root
    let computed_root = compute_merkle_root(leaf_value, path_bits, siblings);
    assert(computed_root == smt_root, "Root mismatch: invalid merkle proof");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_poseidon_deterministic() {
    let h1 = poseidon_hash_2(1, 2);
    let h2 = poseidon_hash_2(1, 2);
    assert(h1 == h2);
}

#[test]
fn test_poseidon_circom_compatible() {
    // Verify circuit produces same hash as circomlibjs / sol_poseidon syscall
    let h12 = poseidon_hash_2(1, 2);
    let expected: Field = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a;
    assert(h12 == expected, "Poseidon hash does not match circomlibjs");
}

#[test]
fn test_poseidon_order_matters() {
    let h1 = poseidon_hash_2(1, 2);
    let h2 = poseidon_hash_2(2, 1);
    assert(h1 != h2);
}

#[test]
fn test_bytes_to_field() {
    let bytes: [u8; 32] = [
        1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,
    ];
    let f = bytes16_to_field(bytes, 0);
    assert(f == 1);
}

#[test]
fn test_pubkey_to_index() {
    let pubkey: [u8; 32] = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 32,
    ];
    let index = pubkey_to_index(pubkey);
    assert(index != 0);

    // Verify against circomlibjs / sol_poseidon syscall value
    let expected: Field = 0x2ad3699bf2d1be62809082180a33ac9b9d4f0575a3fd45441f7baf042f977709;
    assert(index == expected, "pubkey_to_index does not match circomlibjs");
}

#[test]
fn test_merkle_root_deterministic() {
    let siblings: [Field; 4] = [0; 4];
    let leaf: Field = 0;
    let path_bits: [u1; 4] = [0, 1, 0, 1];

    let root1 = compute_merkle_root(leaf, path_bits, siblings);
    let root2 = compute_merkle_root(leaf, path_bits, siblings);
    assert(root1 == root2);
}

#[test]
fn test_merkle_root_path_matters() {
    let siblings: [Field; 4] = [1, 2, 3, 4];
    let leaf: Field = 0;

    let path1: [u1; 4] = [0, 0, 0, 0];
    let path2: [u1; 4] = [1, 0, 0, 0];

    let root1 = compute_merkle_root(leaf, path1, siblings);
    let root2 = compute_merkle_root(leaf, path2, siblings);
    assert(root1 != root2);
}

#[test]
fn test_full_exclusion_proof() {
    // Simulate full circuit with empty tree
    let pubkey: [u8; 32] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e,
        0x1f, 0x20,
    ];

    let pubkey_hash = pubkey_to_index(pubkey);
    let path_bits: [u1; TREE_DEPTH] = pubkey_hash.to_le_bits();
    let siblings: [Field; TREE_DEPTH] = [0; TREE_DEPTH];
    let leaf_value: Field = 0;

    // Compute expected root
    let smt_root = compute_merkle_root(leaf_value, path_bits, siblings);

    // Verify circuit logic
    assert(pubkey_hash == pubkey_to_index(pubkey));
    assert(leaf_value == EMPTY_LEAF);

    let computed_root = compute_merkle_root(leaf_value, path_bits, siblings);
    assert(computed_root == smt_root);
    assert(smt_root != 0);
}
