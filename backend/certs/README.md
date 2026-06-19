# Vendored CA certificates

These are **public** CA certificates (not secrets), committed on purpose.

`course.pku.edu.cn` (Blackboard) ships an **incomplete TLS chain** — its leaf is
issued by *GlobalSign GCC R6 AlphaSSL CA 2025*, but the server sends the wrong
intermediate (*…2023*). Browsers paper over this with AIA fetching; pku3b
(native-tls / OpenSSL) does not, so verification fails with
`unable to get local issuer certificate`.

The backend combines `certifi`'s bundle with every `*.pem` here and points the
`pku3b mcp` subprocess at it via `SSL_CERT_FILE` (see `app/mcp_gateway.py`).

| File | What | Source |
|------|------|--------|
| `globalsign-alphassl-ca-2025.pem` | GlobalSign GCC R6 AlphaSSL CA 2025 (intermediate) | http://secure.globalsign.com/cacert/gsgccr6alphasslca2025.crt |

To add another host whose chain is incomplete: fetch the missing intermediate
from the leaf's *Authority Information Access → CA Issuers* URL, convert to PEM,
and drop it here.
