from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlsplit
import hashlib
import re


@dataclass
class Resource:
    kind: str
    format: str
    source: str
    url: str = field(default="", repr=False)
    data: Optional[str] = field(default=None, repr=False)
    language: str = ""
    warning: str = ""
    status: str = "available"

    @property
    def id(self):
        return hashlib.sha256((self.kind + self.url + (self.data or "")).encode()).hexdigest()[:16]

    def public(self):
        return {"id": self.id, "kind": self.kind, "format": self.format,
                "source": self.source, "language": self.language,
                "warning": self.warning, "status": self.status}


def safe_url(url):
    try:
        p = urlsplit(url)
        return p.scheme in ("http", "https") and bool(p.hostname) and not p.username and not p.password
    except ValueError:
        return False


def filename(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value).strip('. ')[:100] or 'Lecture'
    return '_' + value if re.match(r'^(con|prn|aux|nul|com\d|lpt\d)(\.|$)', value, re.I) else value


def classify(url, mime="", source="network response"):
    if not safe_url(url):
        return None
    mime = mime.split(';')[0].lower().strip()
    ext = urlsplit(url).path.rsplit('.', 1)[-1].lower()
    types = {
        "text/vtt": ("captions", "vtt"), "application/x-subrip": ("captions", "srt"),
        "audio/mp4": ("audio", "m4a"), "audio/mpeg": ("audio", "mp3"),
        "audio/aac": ("audio", "aac"), "audio/ogg": ("audio", "ogg"),
        "video/mp4": ("video", "mp4"), "video/webm": ("video", "webm"),
        "application/vnd.apple.mpegurl": ("video", "hls"),
        "application/x-mpegurl": ("video", "hls"),
    }
    kind_fmt = types.get(mime)
    if not kind_fmt:
        for kind, extensions in [("captions", ("vtt", "srt")), ("audio", ("m4a", "mp3", "aac", "wav", "ogg", "opus")),
                                 ("video", ("mp4", "webm", "m3u8", "mpd"))]:
            if ext in extensions:
                kind_fmt = (kind, "hls" if ext == "m3u8" else ext)
                break
    if not kind_fmt:
        return None
    resource = Resource(*kind_fmt, source=source, url=url)
    if resource.format == 'mpd':
        resource.status = 'unsupported'
        resource.warning = 'DASH assembly is not supported.'
    return resource
