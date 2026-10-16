#!/usr/bin/env python3
"""Small dependency-free persistence smoke test for CI and packaged builds."""

from __future__ import annotations

import argparse
import json
from urllib import request


def call(base_url: str, method: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    req = request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with request.urlopen(req, timeout=10) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("create", "verify"))
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    args = parser.parse_args()

    health = call(args.base_url, "GET", "/health")
    assert health["ok"] is True

    if args.phase == "create":
        initial = call(args.base_url, "GET", "/meetings")
        assert initial["meetings"] == []
        meeting = call(
            args.base_url,
            "POST",
            "/meetings",
            {
                "title": "Release persistence test",
                "duration_seconds": 60,
                "notes": [{"id": "ci-note", "timestamp": 0, "text": "Release gate note."}],
            },
        )
        assert meeting["id"] == 1
        assert meeting["title"] == "Release persistence test"
    else:
        meeting = call(args.base_url, "GET", "/meetings/1")
        assert meeting["title"] == "Release persistence test"
        assert meeting["notes"][0]["text"] == "Release gate note."


if __name__ == "__main__":
    main()
