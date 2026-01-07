import fs from "fs";
import { buildPoseidon, type Poseidon } from "circomlibjs";
import {
  type CircuitConfig,
  type ProofResult,
  getProverTomlPath,
  generateWitness,
  generateGroth16Proof,
  readProofFiles,
} from "@solana-noir-examples/lib/proof";

export {
  type CircuitConfig,
  type ProofResult,
  createInstructionData,
} from "@solana-noir-examples/lib/proof";

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

/** Poseidon hash of two Field elements (Circom-compatible) */
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

/** Hash 32 bytes to a single Field - matches circuit's hash_bytes32() */
export function hashBytes32(bytes: number[]): bigint {
  const low = bytes16ToField(bytes, 0);
  const high = bytes16ToField(bytes, 16);
  return poseidonHash2(low, high);
}

/** Convert Field to 0x-prefixed hex string (64 chars) */
export function fieldToHex(f: bigint): string {
  return "0x" + f.toString(16).padStart(64, "0");
}

export interface VerifySignerInputs {
  hashed_message: number[];
  public_key_x: number[];
  public_key_y: number[];
  signature: number[];
}

function formatByteArray(bytes: number[]): string {
  return "[" + bytes.map((b) => `"${b}"`).join(", ") + "]";
}

function writeVerifySignerProverToml(
  config: CircuitConfig,
  inputs: VerifySignerInputs,
  messageCommitment: bigint
): void {
  const toml = `hashed_message = ${formatByteArray(inputs.hashed_message)}
public_key_x = ${formatByteArray(inputs.public_key_x)}
public_key_y = ${formatByteArray(inputs.public_key_y)}
signature = ${formatByteArray(inputs.signature)}
message_commitment = "${fieldToHex(messageCommitment)}"
`;
  fs.writeFileSync(getProverTomlPath(config), toml);
}

export function generateProof(
  config: CircuitConfig,
  inputs: VerifySignerInputs
): ProofResult {
  // Compute the message commitment (must match circuit's hash_bytes32)
  const messageCommitment = hashBytes32(inputs.hashed_message);
  writeVerifySignerProverToml(config, inputs, messageCommitment);
  generateWitness(config);
  generateGroth16Proof(config);
  return readProofFiles(config);
}

export const TEST_VALUES: VerifySignerInputs = {
  hashed_message: [
    117, 129, 151, 32, 99, 203, 78, 52, 134, 125, 46, 171, 172, 54, 175, 168,
    112, 69, 215, 193, 187, 224, 210, 80, 228, 11, 234, 211, 188, 100, 130, 9,
  ],
  public_key_x: [
    29, 60, 120, 235, 12, 227, 45, 87, 166, 252, 199, 157, 105, 180, 228, 65,
    195, 58, 111, 174, 100, 107, 110, 223, 175, 76, 121, 221, 124, 6, 137, 35,
  ],
  public_key_y: [
    16, 148, 82, 163, 30, 86, 222, 126, 37, 108, 81, 24, 140, 85, 167, 250, 97,
    213, 141, 166, 58, 203, 239, 40, 218, 226, 50, 110, 13, 221, 238, 133,
  ],
  signature: [
    142, 2, 235, 173, 176, 68, 192, 221, 242, 79, 53, 250, 196, 175, 73, 207,
    18, 48, 152, 97, 136, 144, 231, 158, 159, 158, 14, 50, 216, 136, 251, 97,
    52, 160, 251, 216, 255, 151, 206, 229, 71, 189, 145, 102, 212, 207, 158,
    100, 31, 103, 195, 137, 244, 82, 134, 123, 157, 6, 71, 47, 252, 186, 19,
    217,
  ],
};
