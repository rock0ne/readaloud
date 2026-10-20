import { describe, expect, it } from 'vitest';
import { htmlToDocument } from '../src/core/ingest/html';

const types = (html: string) => htmlToDocument(html).map((b) => [b.type, b.text, b.level] as const);

describe('U3 htmlToDocument', () => {
  it('maps headings with levels and paragraphs', () => {
    expect(types('<h1>T</h1><p>One</p><h3>Sub</h3>')).toEqual([
      ['heading', 'T', 1],
      ['paragraph', 'One', undefined],
      ['heading', 'Sub', 3],
    ]);
  });

  it('list items exclude nested lists, which are walked separately', () => {
    const out = types('<ul><li>Top<ul><li>Inner</li></ul></li><li>Second</li></ul>');
    expect(out).toEqual([
      ['list-item', 'Top', undefined],
      ['list-item', 'Inner', undefined],
      ['list-item', 'Second', undefined],
    ]);
  });

  it('blockquote with paragraphs gives quote blocks', () => {
    expect(types('<blockquote><p>A</p><p>B</p></blockquote>').map((x) => x[0])).toEqual(['quote', 'quote']);
    expect(types('<blockquote>Inline <em>only</em></blockquote>')).toEqual([['quote', 'Inline only', undefined]]);
  });

  it('pre is one code block, tr cells join with "; "', () => {
    expect(types('<pre><code>let a = 1;\nlet b = 2;</code></pre>')).toEqual([['code', 'let a = 1; let b = 2;', undefined]]);
    expect(types('<table><tr><th>A</th><td>B</td><td></td></tr></table>')).toEqual([['table-row', 'A; B', undefined]]);
  });

  it('div with only inline content is a paragraph; div with blocks recurses', () => {
    expect(types('<div>Just <b>text</b></div>')).toEqual([['paragraph', 'Just text', undefined]]);
    expect(types('<div>Loose<p>Para</p></div>')).toEqual([
      ['paragraph', 'Loose', undefined],
      ['paragraph', 'Para', undefined],
    ]);
  });

  it('removes script, style, nav, aside and ignores images; br is a space', () => {
    const out = types('<nav>Menu</nav><script>x()</script><style>p{}</style><aside>Note</aside><p>A<br>B<img alt="pic"></p>');
    expect(out).toEqual([['paragraph', 'A B', undefined]]);
  });

  it('collects anchor ids including pending ids from empty anchors and wrappers', () => {
    const blocks = htmlToDocument('<a id="top"></a><h2 id="h">Head</h2><section id="sec"><p>Text <span id="inner">x</span></p></section>', {
      href: 'ch1.xhtml',
    });
    expect(blocks[0]?.anchor).toEqual({ href: 'ch1.xhtml', ids: ['top', 'h'] });
    expect(blocks[1]?.anchor).toEqual({ href: 'ch1.xhtml', ids: ['sec', 'inner'] });
  });

  it('falls back to HTML parsing when XHTML is malformed', () => {
    const out = htmlToDocument('<html><body><p>Broken &nbsp; <br></p></body></html>', { mime: 'application/xhtml+xml' });
    expect(out.map((b) => b.text)).toEqual(['Broken']);
  });
});
