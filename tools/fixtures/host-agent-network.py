#!/usr/bin/env python3
"""CI-only fake native agent. No Docker execution or host management is performed."""
import json
import os
import socketserver
import sys
from http.server import BaseHTTPRequestHandler


class Handler(BaseHTTPRequestHandler):
    def handle_request(self):
        if self.headers.get("x-maintenance-token") != "ci-network-maintenance":
            self.send_response(401)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length:
            self.rfile.read(length)
        body = json.dumps({"ok": True, "version": sys.argv[2], "stdout": "", "stderr": "", "items": []}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = do_POST = handle_request
    def log_message(self, *_args):
        pass


with socketserver.UnixStreamServer(sys.argv[1], Handler) as server:
    os.chmod(sys.argv[1], 0o666)  # CI temp fixture only, never the real agent socket.
    server.serve_forever()
