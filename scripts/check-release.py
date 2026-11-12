"""Verify built artifacts against the same explicit source and runtime lists."""
import importlib.util
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bookmark_build', str(ROOT / 'scripts/build.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
version = build.PACKAGE['version']

for kind, files, prefix in [
    ('extension', build.PACKAGE['files'], 'extension/'),
    ('source', build.SOURCE_FILES, 'bookmark-organizer/')
]:
    path = ROOT / 'dist' / ('bookmark-organizer-{}-{}.zip'.format(version, kind))
    with zipfile.ZipFile(str(path)) as archive:
        assert archive.testzip() is None, 'Damaged archive'
        assert set(archive.namelist()) == {prefix + name for name in files}, 'Unexpected archive file'
        for name in files:
            assert archive.read(prefix + name) == (ROOT / name).read_bytes(), 'Archive content differs: ' + name
    print('{} archive matches {} allowlisted files.'.format(kind, len(files)))

html = (ROOT / 'dist' / ('bookmark-organizer-{}.html'.format(version))).read_text(encoding='utf-8')
scripts = re.findall(r'<script>([\s\S]*?)</script>', html)
assert len(scripts) == 1, 'Standalone page must bundle its scripts'
assert '<span id="app-version">v{}</span>'.format(version) in html, 'Standalone version differs'
subprocess.run(['node', '--check'], input=scripts[0].encode('utf-8'), check=True)
print('Standalone script and displayed version are valid.')
