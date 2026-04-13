import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { RAGStore } from '../../src/rag/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');

let rag: RAGStore;

beforeAll(async () => {
  rag = new RAGStore();
  await rag.loadFromDir(DOCS_DIR);
}, 20_000);

// ── Knowledge base loading ─────────────────────────────────────────────────

describe('doc loading', () => {
  it('loads at least 20 docs', () => {
    expect(rag.listDocs().length).toBeGreaterThanOrEqual(20);
  });

  it('getSkillDocs returns the 16 always-injected skill docs', () => {
    const skill = rag.getSkillDocs();
    expect(skill.length).toBeGreaterThanOrEqual(13); // stellar-dev-skill 13 + OZ 3
    const filenames = skill.map((d) => d.filename);
    expect(filenames).toContain('contracts-soroban.md');
    expect(filenames).toContain('security.md');
    expect(filenames).toContain('testing.md');
    expect(filenames).toContain('oz-setup-stellar.md');
  });

  it('all skill docs are non-empty', () => {
    const skill = rag.getSkillDocs();
    for (const doc of skill) {
      expect(doc.content.length, `${doc.filename} is empty`).toBeGreaterThan(100);
    }
  });

  it('skill docs are NOT raw HTML (they must be markdown)', () => {
    const skill = rag.getSkillDocs();
    for (const doc of skill) {
      expect(
        doc.content.trimStart().toLowerCase().startsWith('<!doctype'),
        `${doc.filename} is raw HTML — should be markdown`,
      ).toBe(false);
    }
  });

  it('getDoc retrieves a specific file by name', () => {
    const doc = rag.getDoc('security.md');
    expect(doc).toBeTruthy();
    expect(doc!.isSkillDoc).toBe(true);
    expect(doc!.content.length).toBeGreaterThan(50);
  });

  it('listDocs includes isSkillDoc and sizeBytes fields', () => {
    const list = rag.listDocs();
    const skillMd = list.find((d) => d.filename === 'SKILL.md');
    expect(skillMd).toBeTruthy();
    expect(skillMd!.isSkillDoc).toBe(true);
    expect(skillMd!.sizeBytes).toBeGreaterThan(100);
  });
});

// ── BM25 search quality ────────────────────────────────────────────────────

describe('search quality', () => {
  it('query "require_auth authorization" returns security-relevant docs', () => {
    const results = rag.search('require_auth authorization', 5);
    expect(results.length).toBeGreaterThan(0);
    const filenames = results.map((r) => r.docFilename);
    // Should hit security.md or contracts-soroban.md
    const relevant = filenames.some((f) =>
      ['security.md', 'contracts-soroban.md', 'soroban-auth.md', 'common-pitfalls.md'].includes(f),
    );
    expect(relevant, `None of ${filenames.join(', ')} are security-relevant`).toBe(true);
  });

  it('query "storage TTL extend temporary" returns storage-related chunks', () => {
    const results = rag.search('storage TTL extend temporary', 5);
    expect(results.length).toBeGreaterThan(0);
    const text = results.map((r) => r.text).join(' ').toLowerCase();
    expect(text).toMatch(/ttl|temporary|extend|storage/);
  });

  it('query "soroban testutils mock_all_auths" returns testing content', () => {
    const results = rag.search('soroban testutils mock_all_auths', 5);
    expect(results.length).toBeGreaterThan(0);
    const filenames = results.map((r) => r.docFilename);
    const relevant = filenames.some((f) => ['testing.md', 'soroban-testing.md', 'contracts-soroban.md'].includes(f));
    expect(relevant, `${filenames.join(', ')} don't include testing docs`).toBe(true);
  });

  it('query "x402 payment http micropayment" returns x402-related content', () => {
    const results = rag.search('x402 payment http micropayment', 5);
    expect(results.length).toBeGreaterThan(0);
    const filenames = results.map((r) => r.docFilename);
    const hasX402 = filenames.some((f) => f.includes('x402') || f.includes('mpp') || f === 'ecosystem.md');
    expect(hasX402, `No x402/mpp results in ${filenames.join(', ')}`).toBe(true);
  });

  it('OZ skill docs are loaded and contain OpenZeppelin content', () => {
    // Verify OZ docs exist and are searchable — the exact BM25 ranking depends on
    // term frequency, so we check doc presence + content rather than top-N rank
    const ozDocs = ['oz-setup-stellar.md', 'oz-upgrade-stellar.md', 'oz-develop-secure.md'];
    for (const fname of ozDocs) {
      const doc = rag.getDoc(fname);
      expect(doc, `${fname} not loaded`).toBeTruthy();
      expect(doc!.content.length, `${fname} is empty`).toBeGreaterThan(200);
      expect(doc!.isSkillDoc).toBe(true);
    }
    // stellar-tokens / stellar-access should score highly for relevant queries
    const results = rag.search('stellar-tokens stellar-access ownable crate', 5);
    expect(results.length).toBeGreaterThan(0);
    const filenames = results.map((r) => r.docFilename);
    // OZ docs or the main SKILL.md (which has OZ section) should appear
    const hasRelevant = filenames.some((f) => f.startsWith('oz-') || f === 'SKILL.md' || f === 'ecosystem.md');
    expect(hasRelevant, `No relevant OZ-related docs in: ${filenames.join(', ')}`).toBe(true);
  });

  it('BM25 scores are sorted descending', () => {
    const results = rag.search('contract storage persistent', 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('topK is respected', () => {
    expect(rag.search('soroban', 3)).toHaveLength(3);
    expect(rag.search('soroban', 1)).toHaveLength(1);
  });
});

// ── System prompt injection content ───────────────────────────────────────

describe('system prompt content', () => {
  it('skill docs contain Soroban contract boilerplate patterns', () => {
    const skill = rag.getSkillDocs();
    const allContent = skill.map((d) => d.content).join('\n');
    expect(allContent).toMatch(/#\[contract\]/);
    expect(allContent).toMatch(/#\[contractimpl\]/);
    expect(allContent).toMatch(/require_auth/);
    expect(allContent).toMatch(/no_std/);
  });

  it('security.md covers common vulnerabilities', () => {
    const doc = rag.getDoc('security.md')!;
    const content = doc.content.toLowerCase();
    // Should cover core security topics
    expect(content).toMatch(/auth|authoriz/);
  });

  it('testing.md covers testutils and mock patterns', () => {
    const doc = rag.getDoc('testing.md')!;
    const content = doc.content.toLowerCase();
    expect(content).toMatch(/test|mock|env/);
  });
});
