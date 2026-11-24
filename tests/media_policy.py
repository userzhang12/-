"""Verify the media destination policy with isolated DNS and HTTP fixtures."""
import os
import socket
from unittest.mock import MagicMock, patch

from api import media


def address(value):
    return (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (value, 443))


def rejects(url):
    try:
        media.media_destination(url)
    except ValueError:
        return
    raise AssertionError("unexpectedly accepted media destination")


origin = "cdn.example.test"
url = f"https://{origin}/output.mp4?token=a%2Bb"
with patch.dict(os.environ, {"JINGXU_MEDIA_HOSTS": origin}):
    with patch.object(media.socket, "getaddrinfo") as dns:
        rejects("https://other.example.test/output.mp4")
        rejects(f"http://{origin}/output.mp4")
        rejects(f"https://{origin}:8443/output.mp4")
        dns.assert_not_called()

        dns.return_value = [address("192.168.1.5"), address("8.8.8.8")]
        rejects(url)

        dns.return_value = [address("8.8.8.8")]
        target, hostname = media.media_destination(url)
        assert target.host == "8.8.8.8" and target.raw_path == b"/output.mp4?token=a%2Bb"
        assert hostname == origin

        response = MagicMock()
        response.iter_bytes.return_value = [b"ab", b"cd"]
        with patch.object(media.httpx, "Client") as client:
            connection = client.return_value.__enter__.return_value
            connection.stream.return_value.__enter__.return_value = response
            assert media.fetch_media(url, limit=4) == b"abcd"
            client.assert_called_with(timeout=60, follow_redirects=False, trust_env=False)
            connection.stream.assert_called_with("GET", target, headers={"Host": hostname},
                                                 extensions={"sni_hostname": hostname})
            try:
                media.fetch_media(url, limit=3)
            except ValueError:
                pass
            else:
                raise AssertionError("accepted media over the size limit")

print("PASS media host authorization, DNS address pinning, TLS hostname and byte limit")
