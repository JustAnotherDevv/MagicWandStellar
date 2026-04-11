import fs from 'fs/promises';
import path from 'path';
import type { DocFile, DocChunk, SearchResult } from '../types/index.js';
import { chunkText } from './chunker.js';
import { buildIndex, searchIndex, tokenize, type BM25Index } from './bm25.js';

/** Strip HTML tags and decode common entities to plain text */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

// Filenames always injected into every system prompt (not just BM25-searchable)
const SKILL_DOC_FILENAMES = new Set([
  'SKILL.md',
  'contracts-soroban.md',
  'frontend-stellar-sdk.md',
  'testing.md',
  'stellar-assets.md',
  'zk-proofs.md',
  'api-rpc-horizon.md',
  'security.md',
  'common-pitfalls.md',
  'advanced-patterns.md',
  'standards-reference.md',
  'ecosystem.md',
  'resources.md',
  // OpenZeppelin skills for Stellar
  'oz-setup-stellar.md',
  'oz-upgrade-stellar.md',
  'oz-develop-secure.md',
  // Agentic payments — promoted to skill docs (hackathon theme)
  'x402-overview.md',
  'x402-quickstart.md',
  'mpp-overview.md',
]);

export class RAGStore {
  private docs = new Map<string, DocFile>();
  private index: BM25Index | null = null;

  async loadFromDir(docsDir: string): Promise<void> {
    let entries: string[];
    try {
      const dirEntries = await fs.readdir(docsDir);
      entries = dirEntries.filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    } catch {
      console.warn(`[RAG] docs directory not found or empty: ${docsDir}`);
      return;
    }

    const allChunks: DocChunk[] = [];

    for (const filename of entries) {
      const filePath = path.join(docsDir, filename);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        console.warn(`[RAG] Could not read ${filename}, skipping`);
        continue;
      }

      // Strip HTML if the file is an HTML page (developer docs returned as HTML)
      if (content.trimStart().toLowerCase().startsWith('<!doctype html')) {
        content = stripHtml(content);
      }

      const isSkillDoc = SKILL_DOC_FILENAMES.has(filename);
      this.docs.set(filename, { filename, content, isSkillDoc });

      const chunks = chunkText(content);
      chunks.forEach((text, chunkIndex) => {
        allChunks.push({
          docFilename: filename,
          chunkIndex,
          text,
          terms: tokenize(text),
        });
      });
    }

    this.index = buildIndex(allChunks);
    console.log(
      `[RAG] Loaded ${this.docs.size} docs, ${allChunks.length} chunks indexed`,
    );
  }

  /** Returns all skill docs sorted consistently — injected into every system prompt */
  getSkillDocs(): DocFile[] {
    return [...this.docs.values()]
      .filter((d) => d.isSkillDoc)
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }

  search(query: string, topK = 5): SearchResult[] {
    if (!this.index) return [];
    return searchIndex(this.index, query, Math.min(topK, 15));
  }

  getDoc(filename: string): DocFile | undefined {
    return this.docs.get(filename);
  }

  listDocs(): Array<{ filename: string; isSkillDoc: boolean; sizeBytes: number }> {
    return [...this.docs.values()].map((d) => ({
      filename: d.filename,
      isSkillDoc: d.isSkillDoc,
      sizeBytes: d.content.length,
    }));
  }

  get isLoaded(): boolean {
    return this.docs.size > 0;
  }
}
