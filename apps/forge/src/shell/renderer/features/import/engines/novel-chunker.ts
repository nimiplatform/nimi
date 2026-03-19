/**
 * Novel Chunker — Chapter-aware text splitting
 *
 * Replicates the logic from @world-engine/engine/chunker.ts
 * with enhanced chapter title extraction for novel import.
 */

export type ChapterChunk = {
  index: number;
  title: string;
  text: string;
};

const HEADING_REGEX =
  /^(?:\s*(?:第[0-9一二三四五六七八九十百千〇零两]+[章节回部卷][^\n\r]*|chapter\s+\d+[^\n\r]*|part\s+\d+[^\n\r]*))$/i;

function extractChapterTitle(section: string): string {
  const firstLine = section.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (HEADING_REGEX.test(firstLine)) return firstLine;
  return '';
}

function splitIntoSections(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join('\n').trim();
    if (joined) sections.push(joined);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (HEADING_REGEX.test(trimmed) && current.length > 0) {
      flush();
    }
    current.push(line);
  }
  flush();
  return sections.length > 0 ? sections : [text];
}

function splitSectionBySize(
  section: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const normalized = section.trim();
  if (!normalized) return [];
  const safeChunkSize = Math.max(600, chunkSize);
  const safeOverlap = Math.max(0, Math.min(overlap, safeChunkSize - 1));
  const chunks: string[] = [];

  let cursor = 0;
  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + safeChunkSize);
    chunks.push(normalized.slice(cursor, end));
    if (end >= normalized.length) break;
    cursor = Math.max(0, end - safeOverlap);
  }
  return chunks;
}

/**
 * Split novel text into chapter-aware chunks.
 *
 * Strategy:
 * 1. Split by chapter headings (Chinese/English patterns)
 * 2. If no headings found, fallback to fixed-size splitting
 * 3. Each chunk gets a title extracted from the heading line
 */
export function splitNovelIntoChapters(
  sourceText: string,
  options?: { chunkSize?: number; overlap?: number },
): ChapterChunk[] {
  const normalized = String(sourceText || '').trim();
  if (!normalized) return [];

  const chunkSize = options?.chunkSize ?? 3000;
  const overlap = options?.overlap ?? 300;
  const sections = splitIntoSections(normalized);

  // If only one section (no headings), use size-based splitting
  if (sections.length === 1) {
    const sizeChunks = splitSectionBySize(normalized, chunkSize, overlap);
    return sizeChunks.map((text, i) => ({
      index: i,
      title: `Chunk ${i + 1}`,
      text,
    }));
  }

  // Each section is a chapter — further split if too long
  const chapters: ChapterChunk[] = [];
  let globalIndex = 0;

  for (const section of sections) {
    const title = extractChapterTitle(section) || `Section ${globalIndex + 1}`;

    if (section.length <= chunkSize * 1.5) {
      // Section fits in one chunk
      chapters.push({ index: globalIndex, title, text: section });
      globalIndex++;
    } else {
      // Section too large — sub-split but keep the same chapter title
      const subChunks = splitSectionBySize(section, chunkSize, overlap);
      for (let j = 0; j < subChunks.length; j++) {
        const subChunk = subChunks[j];
        if (!subChunk) {
          continue;
        }
        const subTitle = subChunks.length > 1 ? `${title} (${j + 1}/${subChunks.length})` : title;
        chapters.push({ index: globalIndex, title: subTitle, text: subChunk });
        globalIndex++;
      }
    }
  }

  return chapters;
}
