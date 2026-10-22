"""Makes the voice download of ReadAloud's Android app (ADR-37) from the sherpa-onnx Kokoro engine APK.

The zip holds only what the app uses: the Kokoro model with its voices, tokens and British
lexicon, eSpeak's data, and the licences. The same APK always gives the same bytes, so anyone
can check the published zip against the official engine APK.

Usage: python -I app/android/make-voice-zip.py ENGINE_APK OUT_ZIP
"""

import hashlib
import sys
import zipfile

MODEL = 'kokoro-multi-lang-v1_0'
KEEP = ('model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-gb-en.txt', 'LICENSE', 'README.md')
NOTICE = """ReadAloud's voice for its Android app (ADR-37 in github.com/rock0ne/readaloud).

Taken unchanged from the sherpa-onnx Kokoro engine APK
sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk
(SHA-256 402c3628712668fb5eb8cc838add6a8f62caffd69ccc53af75384dde1e2142ec)
by app/android/make-voice-zip.py.

- kokoro-multi-lang-v1_0/: the Kokoro-82M v1.0 model by hexgrad (Apache-2.0), in the form
  made by the k2-fsa sherpa-onnx project (Apache-2.0); see its LICENSE and README.md.
- espeak-ng-data/: data of eSpeak NG (GPL-3.0-or-later). Source:
  https://github.com/espeak-ng/espeak-ng
"""
DATE = (1980, 1, 1, 0, 0, 0)


def entry(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    return info


def main(apk: str, out: str) -> None:
    with zipfile.ZipFile(apk) as src:
        names = [f'assets/{MODEL}/{n}' for n in KEEP]
        names += sorted(n for n in src.namelist() if n.startswith('assets/espeak-ng-data/') and not n.endswith('/'))
        with zipfile.ZipFile(out, 'w') as dst:
            dst.writestr(entry('NOTICE.txt'), NOTICE)
            for name in names:
                dst.writestr(entry(name[len('assets/'):]), src.read(name))
    digest = hashlib.sha256()
    size = 0
    with open(out, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
            size += len(block)
    print(f'{out}\nbytes  {size}\nsha256 {digest.hexdigest()}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
