#!/usr/bin/env python3
"""Dev server for The Magician's Apprentice.

Like `python3 -m http.server`, but tells the browser never to cache, so every
refresh picks up code changes (ES modules are otherwise cached aggressively).
Usage: python3 serve.py [port]   (default 5180)
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5180
    print(f"Serving on http://localhost:{port} (no-cache)")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
