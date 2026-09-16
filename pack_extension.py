"""Build a complete extension archive, independent of the current working directory."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import zipfile


def pack_extension():
    base = Path(__file__).resolve().parent
    manifest = json.loads((base / 'manifest.json').read_text(encoding='utf-8-sig'))
    version = manifest['version']
    if not re.fullmatch(r'\d+(?:\.\d+){0,3}', version):
        raise ValueError('Invalid extension version')
    items = [
        'manifest.json', 'background.js', 'tracker-core.js', 'content.js',
        'popup.html', 'popup.js', 'options.html', 'options.js', 'icon.png',
        'README.md', 'PRIVACY.md', '_locales', 'releases',
    ]
    missing = [name for name in items if not (base / name).exists()]
    if missing:
        raise FileNotFoundError('Missing extension files: ' + ', '.join(missing))
    destination = base / f'Video-skipping-and-anime-TV-series-tracking-assistant-v{version}.zip'
    descriptor, temporary_name = tempfile.mkstemp(prefix='skipper-package-', suffix='.zip', dir=base)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in items:
                item = base / name
                files = sorted(p for p in item.rglob('*') if p.is_file()) if item.is_dir() else [item]
                for file in files:
                    archive.write(file, file.relative_to(base).as_posix())
            count = len(archive.namelist())
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    print(f'Packaged v{version}: {count} files')
    print(destination)
    return destination


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    pack_extension()
