import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseX25519PrivateKey,
  parseX25519PublicKey,
} from "../packages/protocol/src/index.ts";
import { generateExitKeyFiles } from "./generate-exit-key.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Exit key generator", () => {
  test("writes valid keys without exposing private key material in output", () => {
    const directory = mkdtempSync(join(tmpdir(), "shallot-keygen-"));
    temporaryDirectories.push(directory);

    const files = generateExitKeyFiles(directory);
    const privateValue = readFileSync(files.privateKeyPath, "utf8");
    const publicValue = readFileSync(files.publicKeyPath, "utf8");

    expect(parseX25519PrivateKey(privateValue).asymmetricKeyType).toBe("x25519");
    expect(parseX25519PublicKey(publicValue).asymmetricKeyType).toBe("x25519");
    expect(statSync(files.privateKeyPath).mode & 0o777).toBe(0o600);
    expect(statSync(files.publicKeyPath).mode & 0o777).toBe(0o644);
    expect(files.privateKeyPath).not.toContain(privateValue.trim());
    expect(files.publicKeyPath).not.toContain(privateValue.trim());
  });

  test("refuses to overwrite an existing key pair by default", () => {
    const directory = mkdtempSync(join(tmpdir(), "shallot-keygen-"));
    temporaryDirectories.push(directory);
    generateExitKeyFiles(directory);

    expect(() => generateExitKeyFiles(directory)).toThrow("already exist");
  });
});
