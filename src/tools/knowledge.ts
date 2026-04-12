import type { ToolResult } from '../types/index.js';
import type { RAGStore } from '../rag/index.js';

export async function searchDocs(
  input: { query: string; topK?: number },
  ragStore: RAGStore,
): Promise<ToolResult> {
  const topK = Math.min(input.topK ?? 5, 15);
  const results = ragStore.search(input.query, topK);

  if (!results.length) {
    return {
      content: `No results found for query: "${input.query}". Try different keywords.`,
      isError: false,
    };
  }

  const formatted = results
    .map(
      (r, i) =>
        `--- Result ${i + 1} (${r.docFilename}, score: ${r.score.toFixed(2)}) ---\n${r.text}`,
    )
    .join('\n\n');

  return { content: formatted, isError: false };
}

export async function getDoc(
  input: { filename: string },
  ragStore: RAGStore,
): Promise<ToolResult> {
  const doc = ragStore.getDoc(input.filename);

  if (!doc) {
    const available = ragStore.listDocs().map((d) => d.filename).join(', ');
    return {
      content: `Document "${input.filename}" not found. Available: ${available}`,
      isError: true,
    };
  }

  return { content: doc.content, isError: false };
}

export async function listDocs(ragStore: RAGStore): Promise<ToolResult> {
  const docs = ragStore.listDocs();

  if (!docs.length) {
    return {
      content: 'No docs loaded. Run `npm run setup:docs` to download documentation.',
      isError: false,
    };
  }

  const lines = docs.map(
    (d) =>
      `${d.filename}${d.isSkillDoc ? ' [skill]' : ''} — ${(d.sizeBytes / 1024).toFixed(1)} KB`,
  );

  return {
    content: `Available documentation (${docs.length} files):\n${lines.join('\n')}`,
    isError: false,
  };
}
