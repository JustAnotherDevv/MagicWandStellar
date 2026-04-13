import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { writeFile } from '../../src/tools/file-ops.js';
import type { Session } from '../../src/types/index.js';

describe('file ops Soroban validation', () => {
  it('rejects invalid Soroban patterns in contracts/*/src/lib.rs', async () => {
    const workspace = path.join(os.tmpdir(), `fo-${randomUUID()}`);
    await fs.mkdir(workspace, { recursive: true });
    const result = await writeFile(
      {
        path: 'token_contract/contracts/token_contract/src/lib.rs',
        content: `#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, symbol_short, I128};

#[contracttype]
pub enum DataKey { Admin }

#[contracterror]
pub enum Error { Bad = 1 }

#[contract]
pub struct C;

#[contractimpl]
impl C {
  pub fn x(env: Env) {
    let _ = DataKey::Initialized;
    env.events().publish((symbol_short!("transfer_from"),), ());
  }
}`,
      },
      workspace,
      undefined,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('I128');
    expect(result.content).toContain('contracterror');
    expect(result.content).toContain('symbol_short!("transfer_from")');
    expect(result.content).toContain('DataKey::Initialized');
  });

  it('rejects scaffold hello-world placeholder contract', async () => {
    const workspace = path.join(os.tmpdir(), `fo-${randomUUID()}`);
    await fs.mkdir(workspace, { recursive: true });
    const result = await writeFile(
      {
        path: 'tipjar/contracts/tipjar/src/lib.rs',
        content: `#![no_std]
use soroban_sdk::{contract, contractimpl, vec, Env, String, Vec};

#[contract]
pub struct Contract;

// This is a sample contract. Replace this placeholder with your own contract logic.
#[contractimpl]
impl Contract {
    pub fn hello(env: Env, to: String) -> Vec<String> {
        vec![&env, String::from_str(&env, "Hello"), to]
    }
}`,
      },
      workspace,
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Scaffold hello-world contract detected');
  });

  it('rejects pathological soroban_sdk import spam', async () => {
    const workspace = path.join(os.tmpdir(), `fo-${randomUUID()}`);
    await fs.mkdir(workspace, { recursive: true });
    const result = await writeFile(
      {
        path: 'tipjar/contracts/tipjar/src/lib.rs',
        content: `#![no_std]
use soroban_sdk::{contract, contractimpl, contracterror, contracttype, Env, Address, String, Vec, panic_with_error_and_message, panic_with_error_and_message, panic_with_message_and_error, unwrap_or_revert};

#[contracttype]
pub enum DataKey { Admin }

#[contracterror]
pub enum Error { Bad = 1 }

#[contract]
pub struct C;

#[contractimpl]
impl C { pub fn x(_env: Env, _to: Address) {} }`,
      },
      workspace,
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid soroban_sdk import');
    expect(result.content).toContain('Duplicate imports detected');
  });

  it('canonicalizes src/lib.rs to real crate path after init layout', async () => {
    const workspace = path.join(os.tmpdir(), `fo-${randomUUID()}`);
    const project = path.join(workspace, 'tipjar');
    const crate = path.join(project, 'contracts', 'tipjar');
    await fs.mkdir(path.join(crate, 'src'), { recursive: true });
    await fs.writeFile(path.join(project, 'Cargo.toml'), '[workspace]\n');
    await fs.writeFile(path.join(crate, 'Cargo.toml'), '[package]\nname = "tipjar"\nversion = "0.0.0"\n');
    await fs.writeFile(path.join(crate, 'src', 'lib.rs'), '#![no_std]\n');

    const result = await writeFile(
      {
        path: 'src/lib.rs',
        content: '#![no_std]\nuse soroban_sdk::{contract, contractimpl, Env};\n#[contract] pub struct C; #[contractimpl] impl C { pub fn ping(_env: Env) {} }',
      },
      workspace,
      { contractDir: 'tipjar' } as Session,
    );

    expect(result.isError).toBe(false);
    expect(result.writtenPath).toBe('tipjar/contracts/tipjar/src/lib.rs');
    const updated = await fs.readFile(path.join(crate, 'src', 'lib.rs'), 'utf-8');
    expect(updated).toContain('pub fn ping');
  });
});
