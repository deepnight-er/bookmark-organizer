"""Build every distribution from the same allowlisted runtime files."""
import argparse
import base64
import json
import hashlib
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
DIST = ROOT / 'dist'
SOURCE_FILES = PACKAGE['files'] + [
    'package.json', 'README.md', 'PRIVACY.md', 'CHANGELOG.md', '.gitignore', 'PRODUCT.md', 'DESIGN.md',
    '.impeccable/design.json', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/images/organizer.png',
    '.github/workflows/check.yml', '.github/workflows/release.yml',
    'scripts/serve.py', 'scripts/build.py', 'scripts/check.cjs', 'scripts/version.cjs',
    'scripts/check-release.py', 'scripts/python.cjs', 'tests/core.test.cjs'
]


def archive(name, files, prefix):
    output_path = DIST / name
    with zipfile.ZipFile(str(output_path), 'w', zipfile.ZIP_DEFLATED) as output:
        for relative in files:
            info = zipfile.ZipInfo(prefix + relative, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, (ROOT / relative).read_bytes())
    return output_path


def standalone(version):
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    scripts = re.findall(r'<script src="([^"]+)" defer></script>', html)
    font = base64.b64encode((ROOT / 'assets/DM-Sans.ttf').read_bytes()).decode('ascii')
    css = (ROOT / 'styles.css').read_text(encoding='utf-8').replace('assets/DM-Sans.ttf', 'data:font/ttf;base64,' + font)
    html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
    html = re.sub(r'  <script src="[^"]+" defer></script>\n', '', html)
    code = '\n'.join((ROOT / name).read_text(encoding='utf-8').replace('</script', '<\\/script') for name in scripts)
    html = html.replace('</body>', '<script>\n' + code + '\n</script>\n</body>')
    output = DIST / ('bookmark-organizer-{}.html'.format(version))
    output.write_text(html, encoding='utf-8')
    return output


def preserve_legacy_seed(target):
    seed_path = target / 'seed.js'
    if not seed_path.exists():
        return
    match = re.fullmatch(r'\s*window\.BOOKMARK_SEED\s*=\s*(\{[\s\S]*\})\s*;\s*', seed_path.read_text(encoding='utf-8'))
    if not match:
        raise RuntimeError('The existing seed cannot be read as a JSON snapshot. Preserve it before syncing.')
    seed = json.loads(match.group(1))
    if seed.get('demo'):
        return
    history = target.parent / 'bookmark-organizer-private' / 'history'
    history.mkdir(parents=True, exist_ok=True)
    content = json.dumps(seed, ensure_ascii=False, indent=2) + '\n'
    digest = hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]
    saved = history / ('bookmarks-legacy-{}.json'.format(digest))
    if not saved.exists():
        saved.write_text(content, encoding='utf-8')



def sync_local(extension_archive, html_archive, version):
    config_path = ROOT / 'private/local-targets.json'
    config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    target = (ROOT / config.get('extensionDirectory', 'dist/local/extension')).resolve()
    if target == ROOT or target in ROOT.parents:
        raise RuntimeError('The local runtime directory must be separate from the source directory.')
    preserve_legacy_seed(target)
    target.mkdir(parents=True, exist_ok=True)
    for name in PACKAGE['files']:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(str(ROOT / name), str(destination))
        if destination.read_bytes() != (ROOT / name).read_bytes():
            raise RuntimeError('Local runtime differs from source: ' + name)
    (target / '使用说明.txt').write_text('书签整理 {}\n本目录由统一源码生成。请在源码目录修改并运行 npm run build:local 更新。\n真实书签由浏览器保存，网页预览使用公开示例。\n'.format(version), encoding='utf-8')
    for key, artifact in [('htmlFile', html_archive), ('archiveFile', extension_archive)]:
        if config.get(key):
            destination = (ROOT / config[key]).resolve()
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(artifact), str(destination))
    print('Local runtime matches all {} source files, version {}.'.format(len(PACKAGE['files']), version))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sync-local', action='store_true')
    args = parser.parse_args()
    subprocess.run(['node', str(ROOT / 'scripts/check.cjs')], cwd=str(ROOT), check=True)
    DIST.mkdir(exist_ok=True)
    version = PACKAGE['version']
    extension = archive('bookmark-organizer-{}-extension.zip'.format(version), PACKAGE['files'], 'extension/')
    archive('bookmark-organizer-{}-source.zip'.format(version), SOURCE_FILES, 'bookmark-organizer/')
    html = standalone(version)
    if args.sync_local:
        sync_local(extension, html, version)
    print('Built source, extension and standalone page for {}.'.format(version))


if __name__ == '__main__':
    main()
