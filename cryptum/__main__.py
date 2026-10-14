import os

from .app import create_server

server = create_server(os.environ.get("CRYPTUM_HOST", "127.0.0.1"), int(os.environ.get("CRYPTUM_PORT", "8000")))
print(f"Codex Cryptum challenge API listening on {server.server_address[0]}:{server.server_port}")
server.serve_forever()
