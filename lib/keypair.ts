import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import fs from "fs";
import path from "path";

async function loadKeypairFromFile(
  filePath: string
): Promise<KeyPairSigner<string>> {
  const resolvedPath = path.resolve(filePath);
  const loadedKeyBytes = Uint8Array.from(
    JSON.parse(fs.readFileSync(resolvedPath, "utf8"))
  );

  return await createKeyPairSignerFromBytes(loadedKeyBytes);
}

export async function getAddressFromKeypairFile(
  filePath: string
): Promise<string> {
  const keypairSigner = await loadKeypairFromFile(filePath);
  return keypairSigner.address;
}
