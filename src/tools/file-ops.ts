import fs from 'fs/promises';
import path from 'path';
import type { ToolResult } from '../types/index.js';

/** Resolve path relative to workspaceDir, throwing on path traversal */
function resolveSafe(workspaceDir: string, relPath: string): string {
  const resolved = path.resolve(workspaceDir, relPath);
  const base = path.resolve(workspaceDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal attempt blocked: "${relPath}"`);
  }
  return resolved;
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
): Promise<ToolResult> {
  try {
    const filePath = resolveSafe(workspaceDir, input.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, 'utf-8');
    return {
      content: `Written ${input.content.length} bytes to ${input.path}`,
      isError: false,
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
