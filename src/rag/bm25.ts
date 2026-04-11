import type { DocChunk, SearchResult } from '../types/index.js';

// BM25 parameters
const K1 = 1.5;
const B = 0.75;

export interface BM25Index {
  chunks: DocChunk[];
  idf: Map<string, number>;
  avgDocLen: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function buildIndex(chunks: DocChunk[]): BM25Index {
  const N = chunks.length;
  if (N === 0) return { chunks, idf: new Map(), avgDocLen: 0 };

  // Document frequency: how many chunks contain each term
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const termSet = new Set(chunk.terms);
    for (const term of termSet) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // IDF scores
  const idf = new Map<string, number>();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }

  const avgDocLen = chunks.reduce((s, c) => s + c.terms.length, 0) / N;

  return { chunks, idf, avgDocLen };
}

function scoreChunk(index: BM25Index, queryTerms: string[], chunkIdx: number): number {
  const chunk = index.chunks[chunkIdx];
  const dl = chunk.terms.length;
  if (dl === 0 || index.avgDocLen === 0) return 0;

  let total = 0;
  for (const qt of queryTerms) {
    const idfScore = index.idf.get(qt) ?? 0;
    if (idfScore === 0) continue;
    const tf = chunk.terms.filter((t) => t === qt).length;
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (dl / index.avgDocLen));
    total += idfScore * (numerator / denominator);
  }
  return total;
}

export function searchIndex(
  index: BM25Index,
  query: string,
  topK: number,
): SearchResult[] {
  if (!index.chunks.length) return [];
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];

  const scored = index.chunks
    .map((_, i) => ({ i, score: scoreChunk(index, queryTerms, i) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((s) => ({
    docFilename: index.chunks[s.i].docFilename,
    chunkIndex: index.chunks[s.i].chunkIndex,
    score: s.score,
    text: index.chunks[s.i].text,
  }));
}
