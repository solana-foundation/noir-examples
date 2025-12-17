// ============================================================================
// Sparse Merkle Tree (SMT) Implementation
// ============================================================================
// Matches the circuit's Poseidon hash function (Circom-compatible) for compatibility.
// Used to:
//   1. Build a blacklist tree off-chain
//   2. Generate merkle proofs (siblings) for the circuit
//   3. Compute roots that can be published on-chain
//
// The SMT is "sparse" - only stores non-empty leaves, not all 2^254 positions.
// Uses Circom-compatible Poseidon hash (same as Solana's sol_poseidon syscall).
// ============================================================================

import { buildPoseidon, type Poseidon } from "circomlibjs";
import { address, getAddressEncoder, type Address } from "@solana/kit";

// Global poseidon instance (initialized lazily)
let poseidonInstance: Poseidon | null = null;

/** Initialize the Poseidon hasher (must be called before using hash functions) */
export async function initPoseidon(): Promise<void> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}

/** Get the initialized Poseidon instance */
function getPoseidon(): Poseidon {
  if (!poseidonInstance) {
    throw new Error("Poseidon not initialized. Call initPoseidon() first.");
  }
  return poseidonInstance;
}

// Must match circuit's TREE_DEPTH (254 bits for BN254 field)
const TREE_DEPTH = 254;

// ============================================================================
// Hash Functions (must match circuit exactly)
// ============================================================================

/** Poseidon hash of two Field elements (Circom-compatible) - matches circuit's poseidon_hash_2() */
export function poseidonHash2(left: bigint, right: bigint): bigint {
  const poseidon = getPoseidon();
  const hash = poseidon([left, right]);
  return poseidon.F.toObject(hash) as bigint;
}

/** Convert 16 bytes to Field (little-endian) - matches circuit's bytes16_to_field() */
export function bytes16ToField(bytes: number[], start: number): bigint {
  let result = 0n;
  let multiplier = 1n;
  for (let i = 0; i < 16; i++) {
    result = result + BigInt(bytes[start + i]) * multiplier;
    multiplier = multiplier * 256n;
  }
  return result;
}

/** Hash 32-byte pubkey to Field index - matches circuit's pubkey_to_index() */
export function pubkeyToIndex(pubkey: number[]): bigint {
  const low = bytes16ToField(pubkey, 0);
  const high = bytes16ToField(pubkey, 16);
  return poseidonHash2(low, high);
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Convert Solana base58 address to byte array */
export function pubkeyToBytes(pubkey: string | Address): number[] {
  const addr = typeof pubkey === "string" ? address(pubkey) : pubkey;
  const encoder = getAddressEncoder();
  return Array.from(encoder.encode(addr));
}

/** Convert Field to 0x-prefixed hex string (64 chars) */
export function fieldToHex(f: bigint): string {
  return "0x" + f.toString(16).padStart(64, "0");
}

/** Extract 254 path bits from index (little-endian) for merkle traversal */
function getPathBits(index: bigint): boolean[] {
  const bits: boolean[] = [];
  let val = index;
  for (let i = 0; i < TREE_DEPTH; i++) {
    bits.push((val & 1n) === 1n);
    val = val >> 1n;
  }
  return bits;
}

// ============================================================================
// Sparse Merkle Tree Class
// ============================================================================

export class SparseMerkleTree {
  // Only stores non-empty leaves: Map<index_as_string, leaf_value>
  private leaves: Map<string, bigint> = new Map();

  // Precomputed hashes for empty subtrees at each level
  // defaultHashes[0] = empty leaf (0)
  // defaultHashes[i] = hash(defaultHashes[i-1], defaultHashes[i-1])
  private defaultHashes: bigint[];

  constructor() {
    this.defaultHashes = new Array(TREE_DEPTH + 1);
    this.defaultHashes[0] = 0n; // Empty leaf value

    // Precompute: hash of two empty children at each level
    for (let i = 1; i <= TREE_DEPTH; i++) {
      const prev = this.defaultHashes[i - 1];
      this.defaultHashes[i] = poseidonHash2(prev, prev);
    }
  }

  /** Insert pubkey into tree (blacklist it). Value defaults to 1. */
  insert(pubkey: number[], value: bigint = 1n): void {
    const index = pubkeyToIndex(pubkey);
    this.leaves.set(index.toString(), value);
  }

  /** Get leaf value at pubkey's position (0 if not in tree) */
  get(pubkey: number[]): bigint {
    const index = pubkeyToIndex(pubkey);
    return this.leaves.get(index.toString()) ?? 0n;
  }

  /** Check if pubkey is blacklisted (leaf != 0) */
  isBlacklisted(pubkey: number[]): boolean {
    return this.get(pubkey) !== 0n;
  }

  /**
   * Compute merkle root of current tree state.
   * Builds tree bottom-up from non-empty leaves.
   */
  getRoot(): bigint {
    if (this.leaves.size === 0) {
      return this.defaultHashes[TREE_DEPTH];
    }

    // Start with leaf level
    let currentLevel = new Map<string, bigint>();
    for (const [indexStr, value] of this.leaves) {
      currentLevel.set(indexStr, value);
    }

    // Build up tree level by level
    for (let level = 0; level < TREE_DEPTH; level++) {
      const nextLevel = new Map<string, bigint>();

      for (const [indexStr, value] of currentLevel) {
        const index = BigInt(indexStr);
        const parentIndex = index >> 1n; // Parent = index / 2
        const isRightChild = (index & 1n) === 1n;
        const siblingIndex = isRightChild ? index - 1n : index + 1n;

        // Sibling is either in tree or use default hash for empty subtree
        const sibling =
          currentLevel.get(siblingIndex.toString()) ??
          this.defaultHashes[level];

        // Hash children in correct order (left, right)
        const [left, right] = isRightChild
          ? [sibling, value]
          : [value, sibling];
        const parentValue = poseidonHash2(left, right);

        nextLevel.set(parentIndex.toString(), parentValue);
      }

      currentLevel = nextLevel;
    }

    return currentLevel.get("0") ?? this.defaultHashes[TREE_DEPTH];
  }

  /**
   * Generate merkle proof for a pubkey.
   * Returns siblings (254 hashes) and leaf value.
   *
   * For circuit: siblings go into private witness, leafValue checked against 0.
   */
  getMerkleProof(pubkey: number[]): { siblings: bigint[]; leafValue: bigint } {
    const index = pubkeyToIndex(pubkey);
    const pathBits = getPathBits(index);
    const leafValue = this.leaves.get(index.toString()) ?? 0n;

    const siblings: bigint[] = [];

    // Build tree to find siblings at each level
    let currentLevel = new Map<string, bigint>();
    for (const [indexStr, value] of this.leaves) {
      currentLevel.set(indexStr, value);
    }

    for (let level = 0; level < TREE_DEPTH; level++) {
      // Calculate position at this level from remaining path bits
      let posAtLevel = 0n;
      for (let i = level; i < TREE_DEPTH; i++) {
        if (pathBits[i]) {
          posAtLevel = posAtLevel | (1n << BigInt(i - level));
        }
      }

      // Get sibling at this level
      const isRight = pathBits[level];
      const siblingPos = isRight ? posAtLevel - 1n : posAtLevel + 1n;
      const sibling =
        currentLevel.get(siblingPos.toString()) ?? this.defaultHashes[level];
      siblings.push(sibling);

      // Build next level up
      const nextLevel = new Map<string, bigint>();
      const processedParents = new Set<string>();

      for (const [indexStr, value] of currentLevel) {
        const idx = BigInt(indexStr);
        const parentIdx = idx >> 1n;
        const parentKey = parentIdx.toString();

        if (processedParents.has(parentKey)) continue;
        processedParents.add(parentKey);

        const isRightChild = (idx & 1n) === 1n;
        const sibIdx = isRightChild ? idx - 1n : idx + 1n;
        const sib =
          currentLevel.get(sibIdx.toString()) ?? this.defaultHashes[level];

        const [left, right] = isRightChild ? [sib, value] : [value, sib];
        nextLevel.set(parentKey, poseidonHash2(left, right));
      }

      currentLevel = nextLevel;
    }

    return { siblings, leafValue };
  }

  /** Get root of empty tree (no blacklisted keys) */
  getEmptyRoot(): bigint {
    return this.defaultHashes[TREE_DEPTH];
  }
}

// ============================================================================
// CLI Demo (run with: npx tsx smt.ts)
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  await initPoseidon();
  console.log("=== SMT Demo ===\n");

  const smt = new SparseMerkleTree();

  // Example Solana pubkeys (these are arbitrary examples)
  const blacklistedPubkey = pubkeyToBytes(
    "FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH"
  );
  const innocentPubkey = pubkeyToBytes(
    "4fYNw3dojWmQ4dXtSGE9epjRGy9pFSx62YypT7avPYvA"
  );

  console.log("1. Empty tree root:", fieldToHex(smt.getRoot()));

  smt.insert(blacklistedPubkey, 1n);
  console.log("\n2. After inserting blacklisted key:");
  console.log("   New root:", fieldToHex(smt.getRoot()));

  console.log("\n3. Blacklist status:");
  console.log(
    "   Blacklisted pubkey in tree?",
    smt.isBlacklisted(blacklistedPubkey)
  );
  console.log("   Innocent pubkey in tree?", smt.isBlacklisted(innocentPubkey));

  console.log("\n4. Exclusion proof for innocent pubkey:");
  const innocentProof = smt.getMerkleProof(innocentPubkey);
  console.log(
    "   Leaf value:",
    innocentProof.leafValue.toString(),
    "(should be 0)"
  );
  console.log("   Pubkey hash:", fieldToHex(pubkeyToIndex(innocentPubkey)));

  console.log("\n5. Proof for blacklisted pubkey:");
  const blacklistedProof = smt.getMerkleProof(blacklistedPubkey);
  console.log(
    "   Leaf value:",
    blacklistedProof.leafValue.toString(),
    "(should be 1 - NOT empty!)"
  );
  console.log("   Pubkey hash:", fieldToHex(pubkeyToIndex(blacklistedPubkey)));

  console.log("\n=== Circuit Inputs for Innocent Pubkey ===");
  console.log(`smt_root = "${fieldToHex(smt.getRoot())}"`);
  console.log(`pubkey_hash = "${fieldToHex(pubkeyToIndex(innocentPubkey))}"`);
  console.log(`leaf_value = "${innocentProof.leafValue}"`);
}
