from urllib.parse import urljoin
import re
from .models import safe_url, Resource


def attrs(raw):
    return {m[0]: m[1].strip('"') for m in re.findall(r'(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)', raw)}


def playlist(raw, base):
    lines = [line.strip() for line in raw.lstrip('\ufeff').splitlines() if line.strip()]
    if not lines or lines[0] != '#EXTM3U':
        raise ValueError('Not an HLS playlist')
    for line in lines:
        if re.match(r'#EXT-X-(KEY|SESSION-KEY):', line) and line != '#EXT-X-KEY:METHOD=NONE':
            raise ValueError('Encrypted HLS is not supported')
        if re.match(r'#EXT-X-(MAP|BYTERANGE|DISCONTINUITY|GAP|PART|SKIP|I-FRAMES-ONLY)', line):
            raise ValueError('Unsupported HLS layout: fMP4, ranges, discontinuity or partial segments')
    variants, tracks, segments = [], [], []
    for i, line in enumerate(lines):
        if line.startswith('#EXT-X-MEDIA:'):
            a = attrs(line[13:])
            if a.get('TYPE') in ('AUDIO', 'SUBTITLES') and a.get('URI'):
                tracks.append((a['TYPE'], urljoin(base, a['URI']), a.get('LANGUAGE', '')))
        elif line.startswith('#EXT-X-STREAM-INF:'):
            if i + 1 >= len(lines) or lines[i+1].startswith('#'):
                raise ValueError('Malformed master playlist')
            variants.append(urljoin(base, lines[i+1]))
        elif not line.startswith('#') and (i == 0 or not lines[i-1].startswith('#EXT-X-STREAM-INF:')):
            segments.append(urljoin(base, line))
    if any(not safe_url(url) for url in variants + segments + [t[1] for t in tracks]):
        raise ValueError('Unsafe playlist URL')
    if not variants and ('#EXT-X-ENDLIST' not in lines or not segments):
        raise ValueError('Only complete HLS VOD is supported')
    if len(segments) > 100000:
        raise ValueError('Too many segments')
    return variants, tracks, segments


async def expand(resources, transport):
    result = []
    for resource in resources:
        result.append(resource)
        if resource.format != 'hls':
            continue
        try:
            variants, tracks, _ = playlist(await transport.text(resource.url, 2*1024*1024), resource.url)
            if tracks:
                resource.status = 'unsupported'
                resource.warning = 'Separate renditions; select the individual feeds. Automatic audio/video muxing is not implemented.'
                for kind, url, language in tracks:
                    result.append(Resource('audio' if kind == 'AUDIO' else 'captions', 'hls' if kind == 'AUDIO' else 'hls-vtt',
                                           'HLS rendition', url=url, language=language,
                                           status='available' if kind == 'AUDIO' else 'unsupported',
                                           warning='' if kind == 'AUDIO' else 'Segmented VTT timestamp maps are unsupported.'))
                for url in variants:
                    result.append(Resource('video', 'hls', 'HLS rendition', url=url))
        except ValueError as error:
            resource.status = 'unsupported'
            resource.warning = str(error)
        except Exception:
            resource.warning = 'Playlist inspection failed; export may fail. Browser-bound auth or network errors may prevent refetch.'
    return list({r.url or r.id: r for r in result}.values())


async def assemble(resource, transport, target, progress):
    url = resource.url
    for _ in range(4):
        variants, tracks, segments = playlist(await transport.text(url, 2*1024*1024), url)
        if tracks:
            raise ValueError('Export separate renditions rather than a combined master')
        if variants:
            url = variants[0]
            continue
        break
    else:
        raise ValueError('Too many nested playlists')
    with target.open('wb') as handle:
        for i, segment in enumerate(segments):
            count = 0
            async for chunk in transport.chunks(segment):
                if not count and chunk[:1] != b'G':
                    raise ValueError('Expected MPEG-TS segments; other formats are unsupported')
                count += len(chunk)
                handle.write(chunk)
            if not count or count % 188:
                raise ValueError('Incomplete MPEG-TS segment')
            progress(f'Segment {i+1}/{len(segments)}')
