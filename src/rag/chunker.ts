const TARGET_SIZE = 600;
const OVERLAP = 100;
const MAX_PARA_SIZE = 800;

/**
 * Split text into overlapping chunks of ~TARGET_SIZE characters.
 * Respects paragraph and sentence boundaries for coherence.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length <= TARGET_SIZE) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
        // Start next chunk with overlap from the end of current
        const overlap = current.slice(-OVERLAP);
        current = para.length <= TARGET_SIZE ? `${overlap}\n\n${para}` : '';
      }

      if (para.length > MAX_PARA_SIZE) {
        // Split large paragraph on sentence boundaries
        const sentences = para.match(/[^.!?\n]+[.!?\n]+/g) ?? [para];
        let sentBuf = '';
        for (const sentence of sentences) {
          if ((sentBuf + sentence).length <= TARGET_SIZE) {
            sentBuf += sentence;
          } else {
            if (sentBuf.trim()) chunks.push(sentBuf.trim());
            sentBuf = sentBuf.slice(-OVERLAP) + sentence;
          }
        }
        if (sentBuf.trim()) current = sentBuf.trim();
      } else if (!current) {
        current = para;
      }
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((c) => c.length > 20);
}
