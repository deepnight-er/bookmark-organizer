"""Serve the public demo on loopback without exposing neighboring files."""
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILES = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['files']


def serve(port):
    expected = 'http://127.0.0.1:{}'.format(port)

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def do_GET(self):
            if self.headers.get('Host') != '127.0.0.1:{}'.format(port):
                self.send_error(403)
                return
            if self.headers.get('Origin') not in (None, expected) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_error(403)
                return
            path = urlsplit(self.path).path
            if path == '/download/extension.zip':
                package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
                archive = ROOT / 'dist' / ('bookmark-organizer-{}-extension.zip'.format(package['version']))
                if not archive.is_file():
                    self.send_error(404, 'Build the extension package with npm run build first')
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Disposition', 'attachment; filename="bookmark-organizer-extension.zip"')
                self.send_header('Content-Length', str(archive.stat().st_size))
                self.end_headers()
                self.wfile.write(archive.read_bytes())
                return
            if path != '/' and path.lstrip('/') not in FILES:
                self.send_error(404)
                return
            super().do_GET()

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            super().end_headers()

    print(expected, flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4490)
    serve(parser.parse_args().port)
