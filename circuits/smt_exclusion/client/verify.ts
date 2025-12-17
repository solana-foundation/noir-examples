import { address } from "@solana/kit";
import path from "path";
import {
  generateProof,
  createInstructionData,
  TEST_VALUES,
  type CircuitConfig,
  type SmtExclusionInputs,
} from "./proof.helper.js";
import {
  SparseMerkleTree,
  pubkeyToBytes,
  pubkeyToIndex,
  fieldToHex,
  initPoseidon,
} from "./smt.js";
import {
  verifyOnChain,
  printTransactionResult,
  handleVerifyError,
} from "@solana-noir-examples/lib/verify";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

// NOTE: This is a devnet example program ID. For production, deploy your own
// verifier via `sunspot deploy` and set PROGRAM_ID environment variable.
const PROGRAM_ID =
  process.env.PROGRAM_ID || "548u4SFWZMaRWZQqdyAgm66z7VRYtNHHF2sr7JTBXbwN";

const circuitConfig: CircuitConfig = {
  circuitDir: path.join(process.cwd(), ".."),
  circuitName: "smt_exclusion",
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
  --program <id>     Verifier program ID (default: ${PROGRAM_ID})
  --corrupt          Corrupt proof to test verifier rejects invalid proofs

Examples:
  npm run verify
  npm run verify -- --program <PROGRAM_ID>
  npm run verify -- --corrupt   # Should fail - proves verifier works
`);
}

async function main() {
  console.log("SMT Exclusion - Solana ZK Verifier Client\n");
  console.log("Proves: pubkey is NOT in the blacklist SMT\n");

  await initPoseidon();

  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const corrupt = args.includes("--corrupt");

  const programIdx = args.indexOf("--program");
  const programIdStr = programIdx !== -1 ? args[programIdx + 1] : PROGRAM_ID;
  const programId = address(programIdStr);

  try {
    const smt = new SparseMerkleTree();
    const pubkeyBytes = pubkeyToBytes(TEST_VALUES.pubkey);
    const proof = smt.getMerkleProof(pubkeyBytes);

    const smtRoot = fieldToHex(smt.getRoot());
    const pubkeyHash = fieldToHex(pubkeyToIndex(pubkeyBytes));

    console.log(`Pubkey: ${TEST_VALUES.pubkey}`);
    console.log(`Pubkey Hash: ${pubkeyHash}`);
    console.log(`SMT Root: ${smtRoot}`);
    console.log(`\nGenerating exclusion proof...\n`);

    const inputs: SmtExclusionInputs = {
      smt_root: smtRoot,
      pubkey_hash: pubkeyHash,
      pubkey: Array.from(pubkeyBytes),
      siblings: proof.siblings.map((s) => s.toString()),
      leaf_value: proof.leafValue.toString(),
    };

    const proofResult = generateProof(circuitConfig, inputs);

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

    console.log("\n✅ Exclusion proof verified on-chain!");
    printTransactionResult(sig);
  } catch (err) {
    handleVerifyError(err);
  }
}

main();
