import type { DocRecord } from '../../core/types';

interface Props {
  doc: DocRecord;
  currentChapter: number;
  onGo: (blockId: string) => void;
}

export function TocPanel({ doc, currentChapter, onGo }: Props) {
  const entries = doc.toc.length > 0 ? doc.toc : doc.chapters.map((c) => ({ title: c.title, level: 1, blockId: c.firstBlockId }));
  const minLevel = Math.min(...entries.map((e) => e.level));
  return (
    <nav class="toc" aria-label="Contents">
      <ol>
        {entries.map((e, i) => {
          const chapterIndex = doc.blocks[Number(e.blockId.slice(1))]?.chapterIndex;
          return (
            <li key={i} style={{ paddingLeft: `${(e.level - minLevel) * 14}px` }}>
              <button class={`link${chapterIndex === currentChapter && e.level === minLevel ? ' active' : ''}`} onClick={() => onGo(e.blockId)}>
                {e.title}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
