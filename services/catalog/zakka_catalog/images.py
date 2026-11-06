"""Product image handling.

* DROPSHIP sources: Zakka is the seller, so supplier images are mirrored into
  Supabase Storage bucket ``product-images`` and our URLs are stored.
* AFFILIATE sources: images are NOT re-hosted. Partner programs require their own
  image URLs, so those are kept and refreshed every run (handled in sync).

Mirroring is idempotent: the object path is derived from the source URL
(``<source>/<sha256(url)[:24]><ext>``), and a per-product map of source URL ->
our URL is kept so unchanged images are not downloaded again.

Backends:
* ``SupabaseImageStore`` when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
  (Storage REST API: ``POST /storage/v1/object/{bucket}/{path}`` with ``x-upsert``;
  the bucket must be public so ``/storage/v1/object/public/...`` URLs work).
* ``LocalImageStore`` (mock): writes a placeholder file per image under
  ``./.cache/images`` and returns its ``file://`` URL. No network.
"""

from __future__ import annotations

import hashlib
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path, PurePosixPath
from typing import Mapping
from urllib.parse import urlsplit

import httpx

log = logging.getLogger(__name__)

BUCKET = "product-images"
MAX_IMAGE_BYTES = 15 * 1024 * 1024
_EXT_BY_TYPE = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
                "image/avif": ".avif"}


def dedupe(urls: list[str]) -> list[str]:
    """Keep first occurrence, preserve order, drop blanks."""
    seen, out = set(), []
    for u in urls:
        u = (u or "").strip()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def object_path(source_code: str, url: str, ext: str | None = None) -> str:
    if ext is None:
        suffix = PurePosixPath(urlsplit(url).path).suffix.lower()
        ext = suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"} else ".jpg"
    return f"{source_code}/{hashlib.sha256(url.encode()).hexdigest()[:24]}{ext}"


class ImageStore(ABC):
    name = "base"

    def mirror(self, source_code: str, urls: list[str], known: Mapping[str, str] | None = None
               ) -> tuple[list[str], dict[str, str], list[str]]:
        """Mirror ``urls`` (deduped, order kept).

        Returns (our_urls_in_order, mapping source->ours, failures). Images that fail
        keep their source URL so the product still has pictures; they are retried next run.
        """
        known = dict(known or {})
        out, failures = [], []
        for url in dedupe(urls):
            if url in known:
                out.append(known[url])
                continue
            try:
                ours = self._put(source_code, url)
                known[url] = ours
                out.append(ours)
            except Exception as exc:
                log.warning("image mirror failed for %s: %s: %s", url, type(exc).__name__, exc)
                failures.append(url)
                out.append(url)
        return out, known, failures

    @abstractmethod
    def _put(self, source_code: str, url: str) -> str: ...


class LocalImageStore(ImageStore):
    name = "local"

    def __init__(self, root: Path | str = Path(".cache") / "images"):
        self.root = Path(root)

    def _put(self, source_code: str, url: str) -> str:
        path = self.root / object_path(source_code, url, ".svg")
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            label = url.replace("&", "&amp;").replace("<", "&lt;")
            path.write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">'
                '<rect width="100%" height="100%" fill="#FBF8F3"/>'
                f'<text x="16" y="200" font-size="12" fill="#1F2937">mock mirror of {label}</text></svg>',
                encoding="utf-8")
        return path.resolve().as_uri()


class SupabaseImageStore(ImageStore):
    name = "supabase"

    def __init__(self, supabase_url: str, service_key: str, *, http: httpx.Client | None = None,
                 bucket: str = BUCKET):
        self.base = supabase_url.rstrip("/")
        self.key = service_key
        self.bucket = bucket
        self.http = http or httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True)

    def public_url(self, path: str) -> str:
        return f"{self.base}/storage/v1/object/public/{self.bucket}/{path}"

    def _put(self, source_code: str, url: str) -> str:
        resp = self.http.get(url)
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        if not ctype.startswith("image/"):
            raise ValueError(f"not an image ({ctype or 'no content-type'})")
        if len(resp.content) > MAX_IMAGE_BYTES:
            raise ValueError(f"image too large ({len(resp.content)} bytes)")
        path = object_path(source_code, url, _EXT_BY_TYPE.get(ctype))
        up = self.http.post(
            f"{self.base}/storage/v1/object/{self.bucket}/{path}", content=resp.content,
            headers={"Authorization": f"Bearer {self.key}", "apikey": self.key, "content-type": ctype,
                     "x-upsert": "true", "cache-control": "max-age=31536000"})
        if up.status_code >= 400:
            raise RuntimeError(f"storage upload HTTP {up.status_code}: {up.text[:200]}")
        return self.public_url(path)


def get_image_store(env: Mapping[str, str] | None = None, cache_dir: Path | str = ".cache") -> ImageStore:
    env = os.environ if env is None else env
    url, key = (env.get("SUPABASE_URL") or "").strip(), (env.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if url and key:
        return SupabaseImageStore(url, key)
    return LocalImageStore(Path(cache_dir) / "images")
