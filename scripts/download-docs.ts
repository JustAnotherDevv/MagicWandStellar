/**
 * Downloads all Stellar/Soroban knowledge docs into the docs/ directory.
 * Run with: npm run setup:docs
 * Called automatically from src/index.ts on startup.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DOCS_DIR = path.resolve(__dirname, '..', 'docs');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface DocEntry {
  filename: string;
  url: string;
  isSkillDoc: boolean;
}

const SKILL_BASE =
  'https://raw.githubusercontent.com/stellar/stellar-dev-skill/main/skill';

const DOCS: DocEntry[] = [
  // ── stellar-dev-skill (13 files, always in system prompt) ────────────────
  { filename: 'SKILL.md', url: `${SKILL_BASE}/SKILL.md`, isSkillDoc: true },
  {
    filename: 'contracts-soroban.md',
    url: `${SKILL_BASE}/contracts-soroban.md`,
    isSkillDoc: true,
  },
  {
    filename: 'frontend-stellar-sdk.md',
    url: `${SKILL_BASE}/frontend-stellar-sdk.md`,
    isSkillDoc: true,
  },
  { filename: 'testing.md', url: `${SKILL_BASE}/testing.md`, isSkillDoc: true },
  {
    filename: 'stellar-assets.md',
    url: `${SKILL_BASE}/stellar-assets.md`,
    isSkillDoc: true,
  },
  {
    filename: 'zk-proofs.md',
    url: `${SKILL_BASE}/zk-proofs.md`,
    isSkillDoc: true,
  },
  {
    filename: 'api-rpc-horizon.md',
    url: `${SKILL_BASE}/api-rpc-horizon.md`,
    isSkillDoc: true,
  },
  { filename: 'security.md', url: `${SKILL_BASE}/security.md`, isSkillDoc: true },
  {
    filename: 'common-pitfalls.md',
    url: `${SKILL_BASE}/common-pitfalls.md`,
    isSkillDoc: true,
  },
  {
    filename: 'advanced-patterns.md',
    url: `${SKILL_BASE}/advanced-patterns.md`,
    isSkillDoc: true,
  },
  {
    filename: 'standards-reference.md',
    url: `${SKILL_BASE}/standards-reference.md`,
    isSkillDoc: true,
  },
  {
    filename: 'ecosystem.md',
    url: `${SKILL_BASE}/ecosystem.md`,
    isSkillDoc: true,
  },
  {
    filename: 'resources.md',
    url: `${SKILL_BASE}/resources.md`,
    isSkillDoc: true,
  },

  // ── OpenZeppelin skills for Stellar (always in system prompt) ───────────────
  {
    filename: 'oz-setup-stellar.md',
    url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-skills/main/skills/setup-stellar-contracts/SKILL.md',
    isSkillDoc: true,
  },
  {
    filename: 'oz-upgrade-stellar.md',
    url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-skills/main/skills/upgrade-stellar-contracts/SKILL.md',
    isSkillDoc: true,
  },
  {
    filename: 'oz-develop-secure.md',
    url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-skills/main/skills/develop-secure-contracts/SKILL.md',
    isSkillDoc: true,
  },

  // ── Additional reference docs (BM25-searchable) ───────────────────────────
  {
    filename: 'llms-index.md',
    url: 'https://developers.stellar.org/llms.txt',
    isSkillDoc: false,
  },
  {
    filename: 'x402-quickstart.md',
    url: 'https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide',
    isSkillDoc: false,
  },
  {
    filename: 'x402-overview.md',
    url: 'https://developers.stellar.org/docs/build/agentic-payments/x402',
    isSkillDoc: false,
  },
  {
    filename: 'mpp-overview.md',
    url: 'https://developers.stellar.org/docs/build/agentic-payments/mpp',
    isSkillDoc: false,
  },
  {
    filename: 'soroban-auth.md',
    url: 'https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization',
    isSkillDoc: false,
  },
  {
    filename: 'soroban-getting-started.md',
    url: 'https://developers.stellar.org/docs/build/smart-contracts/getting-started',
    isSkillDoc: false,
  },
  {
    filename: 'soroban-tokens.md',
    url: 'https://developers.stellar.org/docs/tokens',
    isSkillDoc: false,
  },
  {
    filename: 'soroban-testing.md',
    url: 'https://developers.stellar.org/docs/build/guides/testing',
    isSkillDoc: false,
  },
  {
    filename: 'soroban-storage.md',
    url: 'https://developers.stellar.org/docs/build/guides/storage',
    isSkillDoc: false,
  },
  {
    filename: 'soroban-security.md',
    url: 'https://developers.stellar.org/docs/build/security-docs',
    isSkillDoc: false,
  },
];

async function isFresh(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function fetchDoc(entry: DocEntry, docsDir: string): Promise<void> {
  const filePath = path.join(docsDir, entry.filename);

  if (await isFresh(filePath)) {
    console.log(`  [skip] ${entry.filename} (cached)`);
    return;
  }

  try {
    const res = await fetch(entry.url, {
      headers: { 'User-Agent': 'stellar-agents-rag/1.0' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`  [warn] ${entry.filename}: HTTP ${res.status} from ${entry.url}`);
      return;
    }

    const text = await res.text();
    await fs.writeFile(filePath, text, 'utf-8');
    console.log(`  [ok]   ${entry.filename} (${(text.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [warn] ${entry.filename}: ${msg}`);
  }
}

export async function downloadDocs(docsDir = DEFAULT_DOCS_DIR): Promise<void> {
  await fs.mkdir(docsDir, { recursive: true });
  console.log(`[docs] Downloading to ${docsDir} ...`);

  const results = await Promise.allSettled(
    DOCS.map((entry) => fetchDoc(entry, docsDir)),
  );

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  console.log(`[docs] Done: ${ok} succeeded, ${failed} failed`);
}

// Run directly: npm run setup:docs
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2] ?? DEFAULT_DOCS_DIR;
  downloadDocs(dir).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
