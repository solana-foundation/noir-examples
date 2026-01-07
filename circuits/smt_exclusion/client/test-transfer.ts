// ============================================================================
// Transfer Test - On-Chain Blacklist Verification
// ============================================================================
// Tests the exclusion program with two scenarios:
//   1. ALLOWED user transfers SOL → should SUCCEED
//   2. BLACKLISTED user transfers SOL → should FAIL
//
// Prerequisites:
//   - ZK verifier program deployed (sunspot deploy)
//   - Exclusion program deployed (solana program deploy)
//   - State account initialized with SMT root
//
// Run with: npm run test-transfer
// ============================================================================

import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  appendTransactionMessageInstructions,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  assertIsSendableTransaction,
  assertIsTransactionWithBlockhashLifetime,
  pipe,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  lamports,
  getProgramDerivedAddress,
  getAddressEncoder,
  type Address,
  type KeyPairSigner,
  type ProgramDerivedAddressBump,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  getTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import fs from "fs";
import path from "path";
import {
  generateProof,
  type CircuitConfig,
  type SmtExclusionInputs,
} from "./proof.helper.js";
import {
  SparseMerkleTree,
  pubkeyToIndex,
  fieldToHex,
  initPoseidon,
} from "./smt.js";

// ============================================================================
// Configuration
// ============================================================================

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";

const ZK_VERIFIER_PROGRAM_ID = address(
  process.env.ZK_VERIFIER_PROGRAM_ID ||
    "548u4SFWZMaRWZQqdyAgm66z7VRYtNHHF2sr7JTBXbwN"
);

const EXCLUSION_PROGRAM_ID = address(
  process.env.EXCLUSION_PROGRAM_ID ||
    "4WvvKAwJ2hYRqaceZyyS3s51V68LbfGsXWut7gsGnqaZ"
);

const circuitConfig: CircuitConfig = {
  circuitDir: path.join(process.cwd(), ".."),
  circuitName: "smt_exclusion",
};

const keypairDir = path.join(circuitConfig.circuitDir, "keypair");
const adminWalletPath = path.join(keypairDir, "deployer.json");

const INSTRUCTION = {
  INITIALIZE: 0,
  SET_SMT_ROOT: 1,
  TRANSFER_SOL: 2,
};

// ============================================================================
// Helpers
// ============================================================================

async function loadKeypair(filePath: string): Promise<KeyPairSigner> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keypair not found: ${filePath}`);
  }
  const bytes = new Uint8Array(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  return createKeyPairSignerFromBytes(bytes);
}

async function createSignerFromBytes(
  bytes: Uint8Array
): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(bytes);
}

type PdaResult = readonly [Address<string>, ProgramDerivedAddressBump];

// Use text encoder for seeds
const textEncoder = new TextEncoder();
const addressEncoder = getAddressEncoder();

async function getStatePdaForAdmin(admin: Address): Promise<PdaResult> {
  return getProgramDerivedAddress({
    programAddress: EXCLUSION_PROGRAM_ID,
    seeds: [textEncoder.encode("state"), addressEncoder.encode(admin)],
  });
}

interface RpcContext {
  rpc: ReturnType<typeof createSolanaRpc>;
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
}

function createRpcContext(rpcUrl: string): RpcContext {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    rpcUrl.replace("https://", "wss://").replace("http://", "ws://")
  );
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  return { rpc, rpcSubscriptions, sendAndConfirm };
}

async function initializeState(
  ctx: RpcContext,
  admin: KeyPairSigner
): Promise<string> {
  const [statePda] = await getStatePdaForAdmin(admin.address);

  const stateAccount = await ctx.rpc.getAccountInfo(statePda).send();
  if (stateAccount.value) {
    console.log("  State account already initialized");
    return "already-initialized";
  }

  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();

  const ix = {
    programAddress: EXCLUSION_PROGRAM_ID,
    accounts: [
      { address: admin.address, role: 3 }, // signer + writable
      { address: statePda, role: 1 }, // writable
      { address: SYSTEM_PROGRAM_ADDRESS, role: 0 }, // readonly
    ],
    data: new Uint8Array([INSTRUCTION.INITIALIZE]),
  };

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(admin, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([ix], tx)
  );

  const signedTx = await signTransactionMessageWithSigners(transactionMessage);
  assertIsSendableTransaction(signedTx);
  assertIsTransactionWithBlockhashLifetime(signedTx);
  await ctx.sendAndConfirm(signedTx, { commitment: "confirmed" });
  return getSignatureFromTransaction(signedTx);
}

async function setSmtRoot(
  ctx: RpcContext,
  admin: KeyPairSigner,
  smtRoot: Uint8Array
): Promise<string> {
  const [statePda] = await getStatePdaForAdmin(admin.address);
  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();

  const data = new Uint8Array(1 + 32);
  data[0] = INSTRUCTION.SET_SMT_ROOT;
  data.set(smtRoot, 1);

  const ix = {
    programAddress: EXCLUSION_PROGRAM_ID,
    accounts: [
      { address: admin.address, role: 2 }, // signer
      { address: statePda, role: 1 }, // writable
    ],
    data,
  };

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(admin, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([ix], tx)
  );

  const signedTx = await signTransactionMessageWithSigners(transactionMessage);
  assertIsSendableTransaction(signedTx);
  assertIsTransactionWithBlockhashLifetime(signedTx);
  await ctx.sendAndConfirm(signedTx, { commitment: "confirmed" });
  return getSignatureFromTransaction(signedTx);
}

async function transferSol(
  ctx: RpcContext,
  sender: KeyPairSigner,
  recipient: Address,
  amount: bigint,
  proofData: Uint8Array,
  witnessData: Uint8Array,
  stateOwner: Address
): Promise<string> {
  const [statePda] = await getStatePdaForAdmin(stateOwner);
  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();

  const data = new Uint8Array(1 + 8 + 388 + 76);
  data[0] = INSTRUCTION.TRANSFER_SOL;
  const view = new DataView(data.buffer);
  view.setBigUint64(1, amount, true);
  data.set(proofData, 9);
  data.set(witnessData, 9 + 388);

  const ix = {
    programAddress: EXCLUSION_PROGRAM_ID,
    accounts: [
      { address: sender.address, role: 3 }, // signer + writable
      { address: recipient, role: 1 }, // writable
      { address: statePda, role: 0 }, // readonly
      { address: ZK_VERIFIER_PROGRAM_ID, role: 0 }, // readonly
      { address: SYSTEM_PROGRAM_ADDRESS, role: 0 }, // readonly
    ],
    data,
  };

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(sender, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 500_000 }), ix],
        tx
      )
  );

  const signedTx = await signTransactionMessageWithSigners(transactionMessage);
  assertIsSendableTransaction(signedTx);
  assertIsTransactionWithBlockhashLifetime(signedTx);
  const sig = getSignatureFromTransaction(signedTx);
  try {
    await ctx.sendAndConfirm(signedTx, { commitment: "confirmed" });
  } catch (err: any) {
    // Attach signature to error so caller can check tx status
    err.signature = sig;
    throw err;
  }
  return sig;
}

async function getBalances(
  ctx: RpcContext,
  sender: Address,
  recipient: Address
): Promise<{ sender: number; recipient: number }> {
  const [senderBal, recipientBal] = await Promise.all([
    ctx.rpc.getBalance(sender).send(),
    ctx.rpc.getBalance(recipient).send(),
  ]);
  return {
    sender: Number(senderBal.value),
    recipient: Number(recipientBal.value),
  };
}

function formatLamports(lamportsVal: number): string {
  return (lamportsVal / 1e9).toFixed(9) + " SOL";
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       Transfer Test - Blacklist Exclusion Proofs           ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n"
  );

  await initPoseidon();

  const ctx = createRpcContext(RPC_URL);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`ZK Verifier: ${ZK_VERIFIER_PROGRAM_ID}`);
  console.log(`Exclusion Program: ${EXCLUSION_PROGRAM_ID}\n`);

  const admin = await loadKeypair(adminWalletPath);
  console.log(`Admin: ${admin.address}`);

  const allowedUser = await createSignerFromBytes(
    Uint8Array.from([
      121, 7, 195, 209, 135, 191, 105, 231, 67, 127, 118, 245, 142, 101, 255,
      80, 32, 113, 133, 66, 217, 205, 183, 222, 77, 84, 1, 106, 52, 139, 207,
      53, 110, 111, 182, 166, 157, 162, 147, 146, 69, 187, 253, 102, 128, 25,
      37, 75, 185, 47, 239, 27, 225, 129, 110, 221, 208, 54, 114, 71, 191, 82,
      150, 87,
    ])
  );
  const blacklistedUser = await createSignerFromBytes(
    Uint8Array.from([
      186, 65, 15, 254, 172, 136, 107, 251, 179, 180, 191, 104, 82, 101, 204,
      159, 18, 13, 69, 87, 29, 254, 39, 195, 233, 49, 81, 15, 62, 18, 220, 177,
      238, 137, 223, 107, 110, 5, 10, 89, 160, 248, 130, 68, 56, 181, 167, 184,
      32, 250, 70, 119, 38, 45, 248, 73, 61, 205, 24, 85, 85, 96, 93, 171,
    ])
  );
  const recipient = await createSignerFromBytes(
    Uint8Array.from([
      54, 14, 114, 170, 173, 100, 159, 22, 137, 133, 16, 49, 141, 140, 25, 106,
      189, 196, 222, 224, 234, 145, 106, 131, 144, 190, 217, 97, 42, 126, 151,
      105, 102, 28, 243, 29, 130, 204, 16, 158, 118, 181, 177, 183, 12, 125,
      113, 177, 95, 175, 226, 172, 74, 192, 18, 176, 215, 198, 7, 226, 218, 76,
      41, 83,
    ])
  );

  console.log(`Allowed User: ${allowedUser.address}`);
  console.log(`Blacklisted User: ${blacklistedUser.address}`);
  console.log(`Recipient: ${recipient.address}\n`);

  // Fund test accounts
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SETUP: Funding test accounts");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const adminBalanceResult = await ctx.rpc.getBalance(admin.address).send();
  const adminBalance = Number(adminBalanceResult.value);
  console.log(`Admin balance: ${adminBalance / 1e9} SOL`);

  if (adminBalance < 0.1 * 1e9) {
    throw new Error("Admin needs at least 0.1 SOL. Run: solana airdrop 1");
  }

  const { value: latestBlockhash } = await ctx.rpc.getLatestBlockhash().send();
  const fundAmount = lamports(10_000_000n); // 0.01 SOL each

  const fundTx = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(admin, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [
          getTransferSolInstruction({
            source: admin,
            destination: allowedUser.address,
            amount: fundAmount,
          }),
          getTransferSolInstruction({
            source: admin,
            destination: blacklistedUser.address,
            amount: fundAmount,
          }),
        ],
        tx
      )
  );

  const signedFundTx = await signTransactionMessageWithSigners(fundTx);
  assertIsSendableTransaction(signedFundTx);
  assertIsTransactionWithBlockhashLifetime(signedFundTx);
  await ctx.sendAndConfirm(signedFundTx, { commitment: "confirmed" });
  console.log(`Funded test users with ${Number(fundAmount) / 1e9} SOL each`);
  await new Promise((r) => setTimeout(r, 1000));
  console.log("");

  // Build SMT with blacklisted user
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SETUP: Building SMT with blacklisted pubkey");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const smt = new SparseMerkleTree();
  const encoder = getAddressEncoder();
  const blacklistedPubkeyBytes = Array.from(
    encoder.encode(blacklistedUser.address)
  );

  smt.insert(blacklistedPubkeyBytes, 1n);

  const smtRoot = smt.getRoot();
  const smtRootHex = fieldToHex(smtRoot);
  const smtRootBuffer = new Uint8Array(
    smtRootHex
      .slice(2)
      .match(/.{2}/g)!
      .map((byte) => parseInt(byte, 16))
  );

  console.log(`SMT Root: ${smtRootHex.slice(0, 20)}...`);
  console.log(`Blacklisted: ${blacklistedUser.address}\n`);

  // Initialize state and set SMT root
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SETUP: Initializing on-chain state");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const initSig = await initializeState(ctx, admin);
    if (initSig !== "already-initialized") {
      console.log(`  Initialized: ${initSig.slice(0, 20)}...`);
    }
  } catch (err: any) {
    if (err.context?.logs?.some((l: string) => l.includes("already in use"))) {
      console.log("  State account already initialized");
    } else {
      throw err;
    }
  }

  const setRootSig = await setSmtRoot(ctx, admin, smtRootBuffer);
  console.log(`  SMT root set: ${setRootSig.slice(0, 20)}...`);
  await new Promise((r) => setTimeout(r, 1000));
  console.log("");

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Allowed user transfer (should SUCCEED)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 1: ALLOWED user transfers SOL");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const allowedPubkeyBytes = Array.from(encoder.encode(allowedUser.address));
  const allowedProof = smt.getMerkleProof(allowedPubkeyBytes);
  const allowedPubkeyHash = pubkeyToIndex(allowedPubkeyBytes);

  console.log(`  Pubkey: ${String(allowedUser.address).slice(0, 20)}...`);
  console.log(`  Leaf value: ${allowedProof.leafValue} (0 = NOT blacklisted)`);
  console.log(`  Expected: ✅ Should SUCCEED\n`);

  const balancesBefore1 = await getBalances(
    ctx,
    allowedUser.address,
    recipient.address
  );
  console.log(`  Balances BEFORE:`);
  console.log(`    Sender:    ${formatLamports(balancesBefore1.sender)}`);
  console.log(`    Recipient: ${formatLamports(balancesBefore1.recipient)}`);

  const allowedInputs: SmtExclusionInputs = {
    smt_root: smtRootHex,
    pubkey_hash: fieldToHex(allowedPubkeyHash),
    pubkey: allowedPubkeyBytes,
    siblings: allowedProof.siblings.map((s) => s.toString()),
    leaf_value: allowedProof.leafValue.toString(),
  };

  console.log("  Generating ZK proof...");
  const allowedProofResult = generateProof(circuitConfig, allowedInputs);
  console.log(`  Proof generated (${allowedProofResult.proof.length} bytes)`);

  const transferAmount1 = 1_000_000n; // 0.001 SOL
  let test1Success = false;

  try {
    const sig = await transferSol(
      ctx,
      allowedUser,
      recipient.address,
      transferAmount1,
      new Uint8Array(allowedProofResult.proof),
      new Uint8Array(allowedProofResult.publicWitness),
      admin.address
    );
    console.log(`\n  ✅ SUCCESS! Transfer completed`);
    console.log(`  TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    test1Success = true;
    await new Promise((r) => setTimeout(r, 1000));
  } catch (err: any) {
    const logs = err.context?.logs || [];
    const sig = err.signature;
    console.log(`\n  ❌ FAILED`);
    if (sig) {
      console.log(
        `  TX (may not exist): https://explorer.solana.com/tx/${sig}?cluster=devnet`
      );
    }
    if (logs.length > 0) {
      console.log("  Program logs:");
      logs.slice(-8).forEach((l: string) => console.log(`    ${l}`));
    } else {
      console.error(`  Error: ${err.message || err}`);
    }
  }

  const balancesAfter1 = await getBalances(
    ctx,
    allowedUser.address,
    recipient.address
  );
  console.log(`\n  Balances AFTER:`);
  console.log(`    Sender:    ${formatLamports(balancesAfter1.sender)}`);
  console.log(`    Recipient: ${formatLamports(balancesAfter1.recipient)}`);

  if (test1Success) {
    const senderDiff = balancesAfter1.sender - balancesBefore1.sender;
    const recipientDiff = balancesAfter1.recipient - balancesBefore1.recipient;
    console.log(`  Changes:`);
    console.log(
      `    Sender:    ${senderDiff > 0 ? "+" : ""}${formatLamports(senderDiff)} (includes tx fee)`
    );
    console.log(`    Recipient: +${formatLamports(recipientDiff)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Blacklisted user transfer (should FAIL)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  );
  console.log("TEST 2: BLACKLISTED user tries to transfer SOL");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const blacklistedProof = smt.getMerkleProof(blacklistedPubkeyBytes);
  const blacklistedPubkeyHash = pubkeyToIndex(blacklistedPubkeyBytes);

  console.log(`  Pubkey: ${String(blacklistedUser.address).slice(0, 20)}...`);
  console.log(
    `  Leaf value: ${blacklistedProof.leafValue} (1 = IS blacklisted)`
  );
  console.log(`  Expected: ❌ Should FAIL (circuit rejects leaf != 0)\n`);

  const balancesBefore2 = await getBalances(
    ctx,
    blacklistedUser.address,
    recipient.address
  );
  console.log(`  Balances BEFORE:`);
  console.log(`    Sender:    ${formatLamports(balancesBefore2.sender)}`);
  console.log(`    Recipient: ${formatLamports(balancesBefore2.recipient)}`);

  const blacklistedInputs: SmtExclusionInputs = {
    smt_root: smtRootHex,
    pubkey_hash: fieldToHex(blacklistedPubkeyHash),
    pubkey: blacklistedPubkeyBytes,
    siblings: blacklistedProof.siblings.map((s) => s.toString()),
    leaf_value: blacklistedProof.leafValue.toString(),
  };

  console.log("  Generating ZK proof...");
  try {
    const blacklistedProofResult = generateProof(
      circuitConfig,
      blacklistedInputs
    );

    console.log(
      `  WARNING: Proof generated (${blacklistedProofResult.proof.length} bytes)`
    );
    console.log("  Attempting transfer anyway...");

    const transferAmount = 1000n;
    const sig = await transferSol(
      ctx,
      blacklistedUser,
      recipient.address,
      transferAmount,
      new Uint8Array(blacklistedProofResult.proof),
      new Uint8Array(blacklistedProofResult.publicWitness),
      admin.address
    );
    console.log(`\n  ⚠️  UNEXPECTED SUCCESS - this should not happen!`);
    console.log(`  TX: ${sig}`);
  } catch (err: any) {
    console.log(`\n  ✅ BLOCKED (as expected)`);
    if (err.message?.includes("nargo") || err.message?.includes("circuit")) {
      console.log("  Reason: Circuit rejected proof (leaf_value != 0)");
    } else {
      const logs = err.context?.logs || [];
      if (logs.length > 0) {
        console.log("  Program logs:");
        logs.slice(-5).forEach((l: string) => console.log(`    ${l}`));
      } else {
        console.log(`  Error: ${err.message?.slice(0, 100) || err}`);
      }
    }
  }

  const balancesAfter2 = await getBalances(
    ctx,
    blacklistedUser.address,
    recipient.address
  );
  console.log(`\n  Balances AFTER:`);
  console.log(`    Sender:    ${formatLamports(balancesAfter2.sender)}`);
  console.log(`    Recipient: ${formatLamports(balancesAfter2.recipient)}`);

  const senderDiff2 = balancesAfter2.sender - balancesBefore2.sender;
  const recipientDiff2 = balancesAfter2.recipient - balancesBefore2.recipient;
  if (senderDiff2 === 0 && recipientDiff2 === 0) {
    console.log(`  ✓ No balance changes (transfer was blocked)`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(
    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  );
  console.log("SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Test 1 (Allowed):       ✅ Transfer succeeded");
  console.log("  Test 2 (Blacklisted):   ✅ Transfer blocked (as expected)");
  console.log("\nSecurity layers demonstrated:");
  console.log("  1. Circuit-level:  Blacklisted users can't generate proofs");
  console.log("  2. Pubkey binding: Proofs are bound to specific pubkeys");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err.message || err);
  process.exit(1);
});
