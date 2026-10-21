import JSZip from 'jszip';

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body>${body}</body>
</html>`;

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const chapters = {
  'ch1.xhtml': xhtml('One', '<h1>Chapter One</h1><p>The first chapter starts here. It has two sentences.</p>'),
  'ch2.xhtml': xhtml(
    'Two',
    '<div class="title">Chapter Two</div><p>Opening paragraph of two.</p><p id="part2">Part two begins in this paragraph, which is longer than a title.</p>',
  ),
  'ch 3.xhtml': xhtml('Three', '<h1>Chapter Three</h1><p>Final words.</p>'),
  'notes.xhtml': xhtml('Notes', '<p>Endnote text that is not in the reading order.</p>'),
};

interface Options {
  version?: 2 | 3;
  drm?: boolean;
  /** adds a picture of this many bytes, stored uncompressed (ADR-26) */
  pictureBytes?: number;
}

export async function makeEpub(opts: Options = {}): Promise<ArrayBuffer> {
  const version = opts.version ?? 3;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', container);
  if (opts.drm) {
    zip.file(
      'META-INF/encryption.xml',
      `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData><enc:CipherData><enc:CipherReference URI="OEBPS/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`,
    );
  }
  for (const [name, body] of Object.entries(chapters)) zip.file(`OEBPS/${name}`, body);
  if (opts.pictureBytes) zip.file('OEBPS/images/cover.png', new Uint8Array(opts.pictureBytes), { compression: 'STORE' });

  const navItem =
    version === 3
      ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title><dc:language>en-GB</dc:language><dc:identifier id="id">x</dc:identifier>
  </metadata>
  <manifest>
    ${navItem}
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="ch%203.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine${version === 2 ? ' toc="ncx"' : ''}>
    <itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="notes" linear="no"/>
  </spine>
</package>`,
  );
  if (version === 3) {
    zip.file(
      'OEBPS/nav.xhtml',
      xhtml(
        'Contents',
        `<nav epub:type="toc"><ol>
          <li><a href="ch1.xhtml">Chapter One</a></li>
          <li><a href="ch2.xhtml">Chapter Two</a><ol><li><a href="ch2.xhtml#part2">Part Two</a></li></ol></li>
          <li><a href="ch%203.xhtml">Chapter Three</a></li>
        </ol></nav>`,
      ),
    );
  } else {
    zip.file(
      'OEBPS/toc.ncx',
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
        <navPoint id="n1"><navLabel><text>Chapter One</text></navLabel><content src="ch1.xhtml"/></navPoint>
        <navPoint id="n2"><navLabel><text>Chapter Two</text></navLabel><content src="ch2.xhtml"/>
          <navPoint id="n2a"><navLabel><text>Part Two</text></navLabel><content src="ch2.xhtml#part2"/></navPoint>
        </navPoint>
        <navPoint id="n3"><navLabel><text>Chapter Three</text></navLabel><content src="ch%203.xhtml"/></navPoint>
      </navMap></ncx>`,
    );
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}
