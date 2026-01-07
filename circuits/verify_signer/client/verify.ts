import { address } from "@solana/kit";
import path from "path";
import {
  type CircuitConfig,
  generateProof,
  createInstructionData,
  initPoseidon,
  hashBytes32,
  fieldToHex,
  TEST_VALUES,
} from "./proof.helper.js";
import {
  verifyOnChain,
  printTransactionResult,
  handleVerifyError,
} from "@solana-noir-examples/lib/verify";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

// NOTE: This is a devnet example program ID. For production, deploy your own
// verifier via `sunspot deploy` and set PROGRAM_ID environment variable.
const PROGRAM_ID =
  process.env.PROGRAM_ID || "7uatSejNcJvmp8G19F6F54uyzLkkMYnEgD58pFTTuW1A";

const circuitConfig: CircuitConfig = {
  circuitDir: path.join(process.cwd(), ".."),
  circuitName: "verify_signer",
};

const walletPath = path.join(
  circuitConfig.circuitDir,
  "keypair",
  "deployer.json"
);

function printUsage() {
  console.log(`
Usage: npm run verify -- [options]

Options:
  --program <id>     Verifier program ID (required - deploy with sunspot first)
  --corrupt          Corrupt proof to test verifier rejects invalid proofs

Examples:
  npm run verify -- --program <PROGRAM_ID>
  npm run verify -- --program <PROGRAM_ID> --corrupt
`);
}

async function main() {
  console.log("ECDSA Signature Verifier - Solana ZK Verifier Client\n");
  console.log("Proves: I know a valid signature for this message\n");
  console.log("Without revealing: which public key signed it\n");

  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const corrupt = args.includes("--corrupt");

  const programIdx = args.indexOf("--program");
  const programIdStr = programIdx !== -1 ? args[programIdx + 1] : PROGRAM_ID;

  if (!programIdStr) {
    console.error("Error: --program <PROGRAM_ID> is required");
    console.error(
      "Deploy the verifier first with: sunspot deploy target/verify_signer.vk"
    );
    printUsage();
    process.exit(1);
  }

  const programId = address(programIdStr);

  try {
    // Initialize poseidon hasher
    await initPoseidon();

    console.log("Using test signature (SHA256 of 'Hello, Noir!')\n");

    // Show the message commitment (public input)
    const messageCommitment = hashBytes32(TEST_VALUES.hashed_message);
    console.log(`Message commitment: ${fieldToHex(messageCommitment)}\n`);

    console.log(`Generating signature verification proof...\n`);

    const proofResult = generateProof(circuitConfig, TEST_VALUES);

    if (corrupt) {
      console.log("⚠️  CORRUPTING PROOF FOR TESTING\n");
      proofResult.proof[0] ^= 0xff;
    }

    console.log(`Proof size: ${proofResult.proof.length} bytes`);
    console.log(`Witness size: ${proofResult.publicWitness.length} bytes`);

    const instructionData = createInstructionData(proofResult);
    console.log(`Total instruction data: ${instructionData.length} bytes\n`);

    const sig = await verifyOnChain(instructionData, {
      rpcUrl: RPC_URL,
      programId,
      walletPath,
    });

    console.log("\n✅ Signature proof verified on-chain!");
    printTransactionResult(sig);
  } catch (err) {
    handleVerifyError(err);
  }
}

main();
