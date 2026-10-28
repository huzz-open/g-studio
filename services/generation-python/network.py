"""Direct API listening and request authority checks."""

import ipaddress
import os
import socket
from urllib.parse import urlsplit

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def listen_host():
    value = os.environ.get("GEN_HOST", "127.0.0.1").strip()
    if value == "localhost":
        return "127.0.0.1"
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        raise ValueError("GEN_HOST must be an IP address, such as 127.0.0.1 or 0.0.0.0") from None


def allowed_origins():
    values = [value.strip().rstrip("/") for value in os.environ.get("GEN_ORIGINS", DEFAULT_ORIGINS).split(",") if value.strip()]
    for value in values:
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or "*" in parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("GEN_ORIGINS must contain exact http(s) origins, without paths or wildcards")
        _ = parsed.port
    return values


def host_allowed(authority, local_address):
    try:
        parsed = urlsplit("//" + authority)
        host = parsed.hostname
        if not host or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return False
        _ = parsed.port
        if host in ("localhost", os.environ.get("GEN_HOST_NAME", "").lower()):
            return True
        address = ipaddress.ip_address(host)
        local = ipaddress.ip_address(local_address.split("%")[0])
        # Only an address of the receiving interface is accepted. Listening on
        # all interfaces must not disable the Host check for arbitrary domains.
        return address == local or address.is_loopback and local.is_loopback
    except (ValueError, AttributeError):
        return False


def service_urls(host=None, port=None):
    host = host or listen_host()
    port = port or os.environ.get("GEN_PORT", "8765")
    addresses = {host}
    if ipaddress.ip_address(host).is_unspecified:
        addresses = {"127.0.0.1" if ":" not in host else "::1"}
        try:
            family = socket.AF_INET6 if ":" in host else socket.AF_INET
            addresses.update(entry[4][0] for entry in socket.getaddrinfo(socket.gethostname(), None, family, socket.SOCK_STREAM))
        except OSError:
            pass
    return [f"http://{'[' + address + ']' if ':' in address else address}:{port}" for address in sorted(addresses)]
