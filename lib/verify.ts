import {
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
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  lamports,
  type Address,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import fs from "fs";

export interface VerifyConfig {
  rpcUrl: string;
  programId: Address;
  walletPath: string;
  computeUnits?: number;
}

export async function verifyOnChain(
  instructionData: Buffer,
  config: VerifyConfig
): Promise<string> {
  if (!fs.existsSync(config.walletPath)) {
    throw new Error(`Wallet not found: ${config.walletPath}`);
  }

  const keypairBytes = new Uint8Array(
    JSON.parse(fs.readFileSync(config.walletPath, "utf-8"))
  );
  const wallet = await createKeyPairSignerFromBytes(keypairBytes);

  console.log(`Wallet: ${wallet.address}`);
  console.log(`Program: ${config.programId}`);

  const rpc = createSolanaRpc(config.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    config.rpcUrl.replace("https://", "wss://").replace("http://", "ws://")
  );
  console.log(`RPC: ${config.rpcUrl}\n`);

  const balanceResult = await rpc.getBalance(wallet.address).send();
  const balance = balanceResult.value;
  console.log(`Balance: ${Number(balance) / 1e9} SOL`);
  if (balance < lamports(10_000_000n)) {
    throw new Error("Insufficient balance. Run: solana airdrop 1");
  }

  const computeUnits = config.computeUnits ?? 500_000;
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const verifyInstruction = {
    programAddress: config.programId,
    accounts: [],
    data: new Uint8Array(instructionData),
  };

  const baseMessage = createTransactionMessage({ version: 0 });
  const messageWithPayer = setTransactionMessageFeePayerSigner(
    wallet,
    baseMessage
  );
  const messageWithLifetime = setTransactionMessageLifetimeUsingBlockhash(
    latestBlockhash,
    messageWithPayer
  );
  const transactionMessage = appendTransactionMessageInstructions(
    [
      getSetComputeUnitLimitInstruction({ units: computeUnits }),
      verifyInstruction,
    ],
    messageWithLifetime
  );

  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  assertIsSendableTransaction(signedTransaction);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);

  console.log("Sending verification transaction...");
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTransaction, { commitment: "confirmed" });

  const sig = getSignatureFromTransaction(signedTransaction);
  return sig;
}

export function printTransactionResult(
  sig: string,
  cluster: string = "devnet"
): void {
  console.log(
    `\nTransaction: https://explorer.solana.com/tx/${sig}?cluster=${cluster}`
  );
}

export function handleVerifyError(err: unknown): never {
  console.error("\n❌ Failed!");
  if (err && typeof err === "object" && "logs" in err) {
    const e = err as { logs: string[] };
    console.error("\nProgram logs:");
    e.logs.forEach((log: string) => console.error(`  ${log}`));
  } else if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
}
