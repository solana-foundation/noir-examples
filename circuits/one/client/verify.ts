import { address } from "@solana/kit";
import path from "path";
import {
  type CircuitConfig,
  generateProofWithInputs,
  createInstructionData,
} from "@solana-noir-examples/lib/proof";
import {
  verifyOnChain,
  printTransactionResult,
  handleVerifyError,
} from "@solana-noir-examples/lib/verify";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

// NOTE: This is a devnet example program ID. For production, deploy your own
// verifier via `sunspot deploy` and set PROGRAM_ID environment variable.
const PROGRAM_ID =
  process.env.PROGRAM_ID || "FgcE5gSBCgcS1aDympdw5RgQLt9RBMberPqsj4JZxdeL";

const circuitConfig: CircuitConfig = {
  circuitDir: path.join(process.cwd(), ".."),
  circuitName: "one",
};

const walletPath = path.join(
  circuitConfig.circuitDir,
  "keypair",
  "deployer.json"
);

async function main() {
  console.log("Circuit One - Solana ZK Verifier Client\n");
  console.log("Circuit: assert(x != y)\n");

  const args = process.argv.slice(2);
  const corrupt = args.includes("--corrupt");
  const numArgs = args.filter((a) => !a.startsWith("--"));
  const x = numArgs[0] ? parseInt(numArgs[0]) : 1;
  const y = numArgs[1] ? parseInt(numArgs[1]) : 2;

  if (x === y) {
    console.error(
      `Error: x (${x}) must not equal y (${y}) - circuit will fail`
    );
    process.exit(1);
  }

  try {
    console.log(`Generating proof for x=${x}, y=${y}...\n`);

    const proofResult = generateProofWithInputs(circuitConfig, { x, y });

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
      programId: address(PROGRAM_ID),
      walletPath,
    });

    console.log("\n✅ Proof verified successfully on-chain!");
    printTransactionResult(sig);
  } catch (err) {
    handleVerifyError(err);
  }
}

main();
