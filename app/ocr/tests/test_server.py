import json
import subprocess
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from ocr_service import server


@pytest.fixture
def base_url(monkeypatch):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def post(url, data=b"img", headers=None):
    req = urllib.request.Request(url, data=data, method="POST", headers=headers or {})
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health(base_url):
    with urllib.request.urlopen(f"{base_url}/health") as res:
        assert json.loads(res.read()) == {"ok": True}


def test_passes_the_options_to_the_reader(base_url, monkeypatch):
    seen = {}

    def fake(data, *, ocr, want_image):
        seen.update(data=data, ocr=ocr, want_image=want_image)
        return {"lines": [], "text": "", "cropped": True}

    monkeypatch.setattr(server, "read_receipt", fake)
    status, body = post(f"{base_url}/v1/receipt?ocr=0&image=1", b"jpeg-bytes")
    assert status == 200 and body["cropped"] is True
    assert seen == {"data": b"jpeg-bytes", "ocr": False, "want_image": True}


@pytest.mark.parametrize(
    "error, status, code",
    [
        (server.Busy(), 503, "busy"),
        (subprocess.TimeoutExpired("x", 1), 504, "timeout"),
        (subprocess.CalledProcessError(1, "x", stderr=b"boom"), 500, "failed"),
    ],
)
def test_maps_reader_errors(base_url, monkeypatch, error, status, code):
    def fake(*_a, **_k):
        raise error

    monkeypatch.setattr(server, "read_receipt", fake)
    assert post(f"{base_url}/v1/receipt") == (status, {"error": code})


def test_rejects_images_it_cannot_decode(base_url, monkeypatch):
    monkeypatch.setattr(server, "read_receipt", lambda *_a, **_k: {"error": "decode_failed"})
    assert post(f"{base_url}/v1/receipt") == (422, {"error": "decode_failed"})


def test_rejects_empty_and_too_large_bodies(base_url, monkeypatch):
    assert post(f"{base_url}/v1/receipt", b"") == (400, {"error": "empty_body"})
    monkeypatch.setattr(server, "MAX_BYTES", 4)
    assert post(f"{base_url}/v1/receipt", b"12345") == (413, {"error": "too_large"})


def test_unknown_paths(base_url):
    assert post(f"{base_url}/v2/receipt") == (404, {"error": "not_found"})


def test_reader_runs_in_a_child_process_and_returns_the_cropped_image(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        out = cmd[cmd.index("--image-out") + 1]
        with open(out, "wb") as f:
            f.write(b"JPEG")
        return subprocess.CompletedProcess(cmd, 0, stdout=b'{"lines": [], "text": ""}', stderr=b"")

    monkeypatch.setattr(server.subprocess, "run", fake_run)
    result = server.read_receipt(b"img", ocr=False, want_image=True)
    assert result["image"] == "SlBFRw=="  # base64("JPEG")
    assert "--no-ocr" in calls[0]
    assert calls[0][1:3] == ["-m", "ocr_service.receipt"]
