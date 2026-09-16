import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface GeneratedKeyFiles {
  privateKeyPath: string;
  publicKeyPath: string;
}

export function generateExitKeyFiles(
  outputDirectory: string,
  overwrite = false,
): GeneratedKeyFiles {
  const directory = resolve(outputDirectory);
  const privateKeyPath = resolve(directory, "exit-private.key");
  const publicKeyPath = resolve(directory, "exit-public.key");

  if (!overwrite && (existsSync(privateKeyPath) || existsSync(publicKeyPath))) {
    throw new Error(
      `Exit key files already exist in ${directory}; pass --force to replace them`,
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privateValue = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64url");
  const publicValue = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(privateKeyPath, `${privateValue}\n`, { mode: 0o600 });
  writeFileSync(publicKeyPath, `${publicValue}\n`, { mode: 0o644 });
  chmodSync(privateKeyPath, 0o600);
  chmodSync(publicKeyPath, 0o644);

  return { privateKeyPath, publicKeyPath };
}

function run(): void {
  const args = Bun.argv.slice(2);
  const overwrite = args.includes("--force");
  const positional = args.filter((argument) => argument !== "--force");
  if (positional.length > 1) {
    throw new Error("usage: bun run keygen [output-directory] [--force]");
  }

  const files = generateExitKeyFiles(positional[0] ?? ".shallot/keys", overwrite);
  console.log(`Private key: ${files.privateKeyPath}`);
  console.log(`Public key:  ${files.publicKeyPath}`);
}

if (import.meta.main) run();
