import fs from 'fs/promises';
import path from 'path';
import type { Session, ToolResult } from '../types/index.js';

/** Resolve path relative to baseDir, throwing on path traversal */
function resolveSafe(baseDir: string, relPath: string): string {
  const resolved = path.resolve(baseDir, relPath);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal attempt blocked: "${relPath}"`);
  }
  return resolved;
}

/**
 * Detect the contract subdirectory created by `stellar contract init`.
 * Returns the subdir name (e.g. "token_contract") if found, or null if
 * Cargo.toml is already at the workspace root.
 */
async function detectContractSubdir(workspaceDir: string): Promise<string | null> {
  try { await fs.access(path.join(workspaceDir, 'Cargo.toml')); return null; } catch { /* not at root */ }
  try {
    const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
    for (const e of entries.filter((e) => e.isDirectory())) {
      try {
        await fs.access(path.join(workspaceDir, e.name, 'Cargo.toml'));
        return e.name;
      } catch { /* not here */ }
    }
  } catch { /* readdir failed */ }
  return null;
}

async function detectContractCrateName(workspaceDir: string, contractDir: string): Promise<string | null> {
  // Common scaffold layout: <contractDir>/contracts/<contractDir>/Cargo.toml
  try {
    await fs.access(path.join(workspaceDir, contractDir, 'contracts', contractDir, 'Cargo.toml'));
    return contractDir;
  } catch { /* continue */ }

  const contractsRoot = path.join(workspaceDir, contractDir, 'contracts');
  try {
    const entries = await fs.readdir(contractsRoot, { withFileTypes: true });
    for (const e of entries.filter((e) => e.isDirectory())) {
      try {
        await fs.access(path.join(contractsRoot, e.name, 'Cargo.toml'));
        return e.name;
      } catch { /* continue */ }
    }
  } catch { /* no contracts root */ }
  return null;
}

/** Files that the agent must never create or overwrite — managed by the scaffold */
const FORBIDDEN_BASENAMES = new Set(['.gitignore', 'README.md', 'Cargo.lock']);

function validateSorobanRustFile(filePath: string, content: string): string[] {
  const errors: string[] = [];
  const normalized = filePath.replace(/\\/g, '/');
  const isContractRust = normalized.endsWith('/src/lib.rs') && normalized.includes('/contracts/');
  if (!isContractRust) return errors;

  if (/\bI128\b/.test(content)) {
    errors.push('Use Rust primitive numeric types (e.g. i128), not I128.');
  }

  // Reject scaffold placeholder contracts from `stellar contract init`.
  // If this survives into build attempts, the agent ignored the user request.
  if (
    content.includes('This is a sample contract. Replace this placeholder with your own contract logic.') ||
    (/\bpub\s+fn\s+hello\s*\(\s*env:\s*Env\s*,\s*to:\s*String\s*\)/.test(content) &&
      content.includes('String::from_str(&env, "Hello")'))
  ) {
    errors.push('Scaffold hello-world contract detected. Replace placeholder/sample contract with the requested implementation.');
  }

  if (content.includes('#[contracterror]') && !/\bcontracterror\b/.test(content.match(/use\s+soroban_sdk::\{[^}]+\}/s)?.[0] ?? '')) {
    errors.push('Missing `contracterror` import in soroban_sdk use list.');
  }

  // Reject pathological import lists that models sometimes generate (hundreds of panic_* / unwrap_* symbols).
  const useList = content.match(/use\s+soroban_sdk::\{([^}]+)\}/s)?.[1];
  if (useList) {
    const rawParts = useList.split(',').map((p) => p.trim()).filter(Boolean);
    if (rawParts.length > 24) {
      errors.push(`soroban_sdk import list is suspiciously long (${rawParts.length} items). Keep imports minimal and specific.`);
    }
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const p of rawParts) {
      if (seen.has(p)) dupes.add(p);
      seen.add(p);
      if (/^panic_/.test(p) || /^unwrap_/.test(p)) {
        errors.push(`Invalid soroban_sdk import "${p}" detected. Do not import panic_/unwrap_ helper names.`);
      }
    }
    if (dupes.size > 0) {
      errors.push(`Duplicate imports detected in soroban_sdk use list: ${Array.from(dupes).slice(0, 5).join(', ')}.`);
    }
  }

  const shortSymbols = [...content.matchAll(/symbol_short!\("([^"]+)"\)/g)];
  for (const m of shortSymbols) {
    const sym = m[1] ?? '';
    if (sym.length > 9) {
      errors.push(`symbol_short!("${sym}") is too long (${sym.length}); max is 9 characters.`);
    }
  }

  const dataKeyEnumMatch = content.match(/pub\s+enum\s+DataKey\s*\{([\s\S]*?)\}/);
  if (dataKeyEnumMatch) {
    const body = dataKeyEnumMatch[1] ?? '';
    const referenced = new Set<string>();
    for (const m of content.matchAll(/DataKey::([A-Za-z_][A-Za-z0-9_]*)/g)) {
      referenced.add(m[1] ?? '');
    }
    for (const key of referenced) {
      if (!new RegExp(`\\b${key}\\b`).test(body)) {
        errors.push(`DataKey::${key} is referenced but not declared in DataKey enum.`);
      }
    }
  }

  return errors;
}

/**
 * Compute the effective base directory for write_file, and the canonical
 * workspace-relative output path (used for file_written SSE events).
 *
 * Handles two path formats the model may emit:
 *   1. Workspace-relative:  "token_contract/contracts/token_contract/src/lib.rs"
 *      → already under contractDir — use workspaceDir as base (no doubling)
 *   2. Project-relative:    "contracts/token_contract/src/lib.rs" or "src/lib.rs"
 *      → prefix with contractDir and use workspaceDir/contractDir as base
 */
async function getWriteBase(
  workspaceDir: string,
  writePath: string,
  session?: Session,
): Promise<{ baseDir: string; workspaceRelativePath: string }> {
  let contractDir = session?.contractDir;
  if (!contractDir) {
    const detected = await detectContractSubdir(workspaceDir);
    if (detected) {
      contractDir = detected;
      if (session) session.contractDir = detected;
    }
  }

  const norm = writePath.replace(/\\/g, '/');
  if (!contractDir) {
    return { baseDir: workspaceDir, workspaceRelativePath: norm };
  }

  const crateName = await detectContractCrateName(workspaceDir, contractDir);
  const canonicalCrateRel = crateName ? `${contractDir}/contracts/${crateName}` : null;

  // Canonicalize ambiguous short paths to the real contract crate.
  // This prevents writes after refresh/session-restore from landing in wrong files
  // like "<contractDir>/src/lib.rs" while the actual crate remains unchanged.
  if (canonicalCrateRel) {
    if (norm === 'src/lib.rs' || norm === 'src/test.rs' || norm === 'tests/test.rs') {
      return {
        baseDir: workspaceDir,
        workspaceRelativePath: `${canonicalCrateRel}/${norm}`,
      };
    }
    if (norm === `${contractDir}/src/lib.rs` || norm === `${contractDir}/src/test.rs`) {
      const suffix = norm.slice(contractDir.length + 1);
      return {
        baseDir: workspaceDir,
        workspaceRelativePath: `${canonicalCrateRel}/${suffix}`,
      };
    }
    if (norm.startsWith('contracts/') && !norm.startsWith(`${contractDir}/contracts/`)) {
      return {
        baseDir: workspaceDir,
        workspaceRelativePath: `${contractDir}/${norm}`,
      };
    }
  }

  // Path is already workspace-relative (starts with or equals contractDir)
  if (norm === contractDir || norm.startsWith(contractDir + '/')) {
    return { baseDir: workspaceDir, workspaceRelativePath: norm };
  }

  // Path is project-relative — prefix with contractDir, use contractDir subdir as base
  return {
    baseDir: path.join(workspaceDir, contractDir),
    workspaceRelativePath: contractDir + '/' + norm,
  };
}

export async function readFile(
  input: { path: string },
  workspaceDir: string,
): Promise<ToolResult> {
  try {
    const filePath = resolveSafe(workspaceDir, input.path);
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, isError: false };
  } catch (err) {
    return { content: `Error reading file: ${(err as Error).message}`, isError: true };
  }
}

export async function writeFile(
  input: { path: string; content: string },
  workspaceDir: string,
  session?: Session,
): Promise<ToolResult> {
  // Block scaffold-managed files the agent must never touch
  const basename = path.basename(input.path);
  const isRootCargoToml = input.path === 'Cargo.toml' || input.path === './Cargo.toml';
  if (FORBIDDEN_BASENAMES.has(basename) || isRootCargoToml) {
    return {
      content: `write_file: refusing to write "${input.path}" — this file is managed by the project scaffold and must not be modified.`,
      isError: true,
    };
  }

  try {
    const { baseDir, workspaceRelativePath } = await getWriteBase(workspaceDir, input.path, session);
    const validationErrors = validateSorobanRustFile(workspaceRelativePath, input.content);
    if (validationErrors.length > 0) {
      return {
        content: `write_file validation failed for ${workspaceRelativePath}:\n- ${validationErrors.join('\n- ')}`,
        isError: true,
      };
    }
    const filePath = resolveSafe(workspaceDir, workspaceRelativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, 'utf-8');
    return {
      content: `Written ${input.content.length} bytes to ${workspaceRelativePath}`,
      isError: false,
      writtenPath: workspaceRelativePath,
    };
  } catch (err) {
    return { content: `Error writing file: ${(err as Error).message}`, isError: true };
  }
}

export async function listDir(
  input: { path: string },
  workspaceDir: string,
): Promise<ToolResult> {
  try {
    const dirPath = resolveSafe(workspaceDir, input.path);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const result = await Promise.all(
      entries.map(async (e) => {
        let size: number | undefined;
        if (e.isFile()) {
          try {
            const stat = await fs.stat(path.join(dirPath, e.name));
            size = stat.size;
          } catch {}
        }
        return {
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          ...(size !== undefined ? { size } : {}),
        };
      }),
    );
    return { content: JSON.stringify({ entries: result }, null, 2), isError: false };
  } catch (err) {
    return { content: `Error listing directory: ${(err as Error).message}`, isError: true };
  }
}

export async function deleteFile(
  input: { path: string },
  workspaceDir: string,
): Promise<ToolResult> {
  try {
    const filePath = resolveSafe(workspaceDir, input.path);
    await fs.unlink(filePath);
    return { content: `Deleted ${input.path}`, isError: false };
  } catch (err) {
    return { content: `Error deleting file: ${(err as Error).message}`, isError: true };
  }
}

export async function makeDir(
  input: { path: string },
  workspaceDir: string,
): Promise<ToolResult> {
  try {
    const dirPath = resolveSafe(workspaceDir, input.path);
    await fs.mkdir(dirPath, { recursive: true });
    return { content: `Directory created: ${input.path}`, isError: false };
  } catch (err) {
    return { content: `Error creating directory: ${(err as Error).message}`, isError: true };
  }
}
