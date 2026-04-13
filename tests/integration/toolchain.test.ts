/**
 * Integration tests: Stellar + Soroban toolchain
 * Verifies that the real stellar CLI, cargo, and WASM build pipeline work correctly.
 * Does NOT require a valid LLM API key.
 *
 * What is tested:
 * 1. stellar contract init creates correct project structure
 * 2. The default template compiles to WASM without errors
 * 3. A hand-crafted minimal contract with security patterns compiles correctly
 * 4. A contract with a cargo test module passes cargo test
 * 5. Path traversal guard rejects malicious paths
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { randomUUID } from 'crypto';

const STELLAR_BIN = process.env.STELLAR_BIN ?? '/opt/homebrew/bin/stellar';

let workDir: string;

beforeAll(async () => {
  workDir = path.join(os.tmpdir(), `stellar-toolchain-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 180_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    const t = setTimeout(() => { proc.kill(); resolve({ stdout, stderr, exitCode: -1 }); }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function listDir(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir)).map((f) => path.join(dir, f)); }
  catch { return []; }
}

// ── stellar contract init ────────────────────────────────────────────────

describe('stellar contract init', () => {
  it('creates expected project structure for a new contract', async () => {
    const projectPath = path.join(workDir, 'hello_init');

    // stellar contract init --name <name> <project-path>
    const { exitCode, stderr } = await run(
      STELLAR_BIN,
      ['contract', 'init', '--name', 'hello_counter', projectPath],
      workDir,
    );
    expect(exitCode, `stellar contract init failed:\n${stderr}`).toBe(0);

    // Expected directory structure
    expect(await fileExists(path.join(projectPath, 'Cargo.toml'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'contracts', 'hello_counter', 'Cargo.toml'))).toBe(true);
    expect(await fileExists(path.join(projectPath, 'contracts', 'hello_counter', 'src', 'lib.rs'))).toBe(true);
  }, 30_000);

  it('initialized contract has #[contract] macro in lib.rs', async () => {
    const projectPath = path.join(workDir, 'check_template');
    await run(STELLAR_BIN, ['contract', 'init', '--name', 'check_contract', projectPath], workDir);

    const libRs = await fs.readFile(
      path.join(projectPath, 'contracts', 'check_contract', 'src', 'lib.rs'),
      'utf-8',
    );
    expect(libRs).toMatch(/#\[contract\]/);
  }, 30_000);
});

// ── stellar contract build (template) ───────────────────────────────────

describe('stellar contract build — default template', () => {
  it('compiles the default hello_counter template to WASM', async () => {
    const projectPath = path.join(workDir, 'build_template');
    await run(STELLAR_BIN, ['contract', 'init', '--name', 'build_test', projectPath], workDir);

    const { exitCode, stderr } = await run(
      STELLAR_BIN,
      ['contract', 'build'],
      projectPath,
      180_000,
    );
    expect(exitCode, `contract build failed:\n${stderr}`).toBe(0);

    // stellar contract build places WASM in target/wasm32*/release/
    const releaseDir = path.join(projectPath, 'target', 'wasm32-unknown-unknown', 'release');
    const altReleaseDir = path.join(projectPath, 'target', 'wasm32v1-none', 'release');
    const wasmInNormal = (await listDir(releaseDir)).filter((f) => f.endsWith('.wasm'));
    const wasmInAlt    = (await listDir(altReleaseDir)).filter((f) => f.endsWith('.wasm'));
    const allWasm = [...wasmInNormal, ...wasmInAlt];
    expect(allWasm.length, `No WASM found in ${releaseDir} or ${altReleaseDir}`).toBeGreaterThan(0);
    // Size can be small for minimal contracts with release opt stripping
    const wasmStat = await fs.stat(allWasm[0]);
    expect(wasmStat.size, 'WASM file is empty (0 bytes)').toBeGreaterThan(0);
  }, 180_000);
});

// ── Hand-crafted counter contract ─────────────────────────────────────────

const COUNTER_CONTRACT = `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, symbol_short, Env, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized     = 2,
    InvalidAmount      = 3,
    Overflow           = 4,
}

#[contracttype]
pub enum DataKey {
    Count,
    Initialized,
    Admin,
}

#[contract]
pub struct CounterContract;

#[contractimpl]
impl CounterContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Count, &0i64);
        env.storage().persistent().set(&DataKey::Initialized, &true);
        env.events().publish((symbol_short!("init"),), (&admin,));
        Ok(())
    }

    pub fn increment(env: Env, caller: Address, by: i64) -> Result<i64, Error> {
        if !env.storage().persistent().has(&DataKey::Initialized) {
            return Err(Error::NotInitialized);
        }
        if by <= 0 {
            return Err(Error::InvalidAmount);
        }
        caller.require_auth();
        let count: i64 = env.storage().persistent().get(&DataKey::Count).unwrap_or(0);
        let new_count = count.checked_add(by).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&DataKey::Count, &new_count);
        env.events().publish((symbol_short!("inc"),), (new_count,));
        Ok(new_count)
    }

    pub fn get(env: Env) -> i64 {
        env.storage().persistent().get(&DataKey::Count).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize_and_increment() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user  = Address::generate(&env);

        // Init sets counter to 0
        client.initialize(&admin);
        assert_eq!(client.get(), 0);

        // Increment accumulates correctly
        assert_eq!(client.increment(&user, &5), 5);
        assert_eq!(client.increment(&user, &3), 8);
        assert_eq!(client.get(), 8);
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin); // must panic — AlreadyInitialized
    }

    #[test]
    #[should_panic]
    fn test_increment_before_init_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.increment(&user, &1); // must panic — NotInitialized
    }

    #[test]
    #[should_panic]
    fn test_invalid_amount_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CounterContract);
        let client = CounterContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user  = Address::generate(&env);
        client.initialize(&admin);
        client.increment(&user, &-1); // must panic — InvalidAmount
    }
}
`;

const COUNTER_CARGO_TOML = `[package]
name = "counter"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
testutils = ["soroban-sdk/testutils"]

[dependencies]
soroban-sdk = { version = "22" }

[dev-dependencies]
soroban-sdk = { version = "22", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
codegen-units = 1
`;

const WORKSPACE_CARGO_TOML = `[workspace]
resolver = "2"
members = ["contracts/counter"]

[workspace.dependencies]
soroban-sdk = { version = "22" }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
codegen-units = 1
`;

describe('hand-crafted counter contract', () => {
  let contractDir: string;

  beforeAll(async () => {
    contractDir = path.join(workDir, 'counter_project');
    await fs.mkdir(path.join(contractDir, 'contracts', 'counter', 'src'), { recursive: true });
    await fs.writeFile(path.join(contractDir, 'Cargo.toml'), WORKSPACE_CARGO_TOML);
    await fs.writeFile(path.join(contractDir, 'contracts', 'counter', 'Cargo.toml'), COUNTER_CARGO_TOML);
    await fs.writeFile(path.join(contractDir, 'contracts', 'counter', 'src', 'lib.rs'), COUNTER_CONTRACT);
  });

  it('counter contract has correct Soroban security patterns', () => {
    expect(COUNTER_CONTRACT).toMatch(/#!\[no_std\]/);
    expect(COUNTER_CONTRACT).toMatch(/#\[contract\]/);
    expect(COUNTER_CONTRACT).toMatch(/#\[contractimpl\]/);
    expect(COUNTER_CONTRACT).toMatch(/#\[contracttype\]/);
    expect(COUNTER_CONTRACT).toMatch(/checked_add/);          // overflow protection
    expect(COUNTER_CONTRACT).toMatch(/DataKey::Initialized/); // re-init guard
    expect(COUNTER_CONTRACT).toMatch(/events\(\)\.publish/); // events emitted
  });

  it('counter contract compiles to WASM without errors', async () => {
    const { exitCode, stderr } = await run(
      STELLAR_BIN,
      ['contract', 'build'],
      contractDir,
      180_000,
    );
    expect(exitCode, `Build failed:\n${stderr}`).toBe(0);

    // Check both possible WASM target dirs (differs by stellar-cli version)
    const releaseDir1 = path.join(contractDir, 'target', 'wasm32-unknown-unknown', 'release');
    const releaseDir2 = path.join(contractDir, 'target', 'wasm32v1-none', 'release');
    const wasm1 = (await listDir(releaseDir1)).filter((f) => f.endsWith('.wasm'));
    const wasm2 = (await listDir(releaseDir2)).filter((f) => f.endsWith('.wasm'));
    expect(
      wasm1.length + wasm2.length,
      `No WASM in ${releaseDir1} or ${releaseDir2}`,
    ).toBeGreaterThan(0);
  }, 180_000);

  it('cargo test passes all unit tests', async () => {
    const { exitCode, stdout, stderr } = await run(
      'cargo',
      ['test', '--features', 'testutils'],
      contractDir,
      120_000,
    );
    expect(exitCode, `cargo test failed:\n${stderr}`).toBe(0);
    expect(stdout + stderr).toMatch(/test.*ok|running \d+ test/i);

    // All 4 test cases should pass
    expect(stdout + stderr).toMatch(/test_initialize_and_increment/);
    expect(stdout + stderr).toMatch(/test_double_initialize_panics/);
    expect(stdout + stderr).toMatch(/test_increment_before_init_panics/);
    expect(stdout + stderr).toMatch(/test_invalid_amount_panics/);
  }, 120_000);
});

// ── Path traversal protection ────────────────────────────────────────────

describe('file-ops path traversal guard', () => {
  it('resolveSafe rejects ../ path traversal', async () => {
    // Import resolveSafe indirectly via file-ops
    const { readFile } = await import('../../src/tools/file-ops.js');
    const workspaceDir = path.join(os.tmpdir(), 'traversal_test_ws');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'ok.txt'), 'content');

    // Valid path should succeed
    const ok = await readFile({ path: 'ok.txt' }, workspaceDir);
    expect(ok.isError).toBe(false);
    expect(ok.content).toBe('content');

    // Traversal path should be rejected
    const bad = await readFile({ path: '../../../etc/passwd' }, workspaceDir);
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/traversal|outside|forbidden/i);

    await fs.rm(workspaceDir, { recursive: true, force: true });
  });
});
