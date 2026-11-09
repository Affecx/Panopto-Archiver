import math
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from .models import Resource, classify, safe_url
from .captions import vtt

# This runs in each frame after JavaScript rendering, including open shadow roots.
SNAPSHOT = r"""() => {
 const roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);
 const cues=[];const urls=[];let tracks=0;
 for(const root of roots){
  for(const el of root.querySelectorAll('video,audio,source,track')){const u=el.currentSrc||el.src;if(u)urls.push(u);}
  for(const media of root.querySelectorAll('video,audio'))for(const track of media.textTracks||[]){if(!['subtitles','captions'].includes(track.kind))continue;tracks++;const loaded=Array.from(track.cues||[]).filter(c=>typeof c.text==='string'&&Number.isFinite(c.startTime)&&Number.isFinite(c.endTime)&&c.endTime>=c.startTime);if(loaded.length)cues.push({language:track.language,cues:loaded.map(c=>({start:c.startTime,end:c.endTime,text:c.text}))});}
 }
 return {html:roots.map(r=>r===document?document.documentElement.outerHTML:r.innerHTML).join('\n'), title:document.title, urls:[...urls,...performance.getEntriesByType('resource').map(e=>e.name)], cues, tracks, encrypted:roots.reduce((n,root)=>n+Array.from(root.querySelectorAll("video,audio")).filter(m=>!!m.mediaKeys).length,0)};
}"""


def html_resources(html, base):
    soup = BeautifulSoup(html, 'html.parser')
    resources = []
    for anchor in soup.select('a[download]'):
        url = urljoin(base, anchor.get('href', ''))
        if not safe_url(url):
            continue
        resource = classify(url, source='rendered download link')
        if resource is None:
            resource = Resource('attachment', 'bin', 'rendered download link', url=url)
        resources.append(resource)
    # Semantic caption/transcript regions only; no tenant-specific CSS schema is assumed.
    for panel in soup.select('[role="tabpanel"], [role="region"], [aria-label]'):
        label = panel.get('aria-label', '')
        for label_id in panel.get('aria-labelledby', '').split():
            node = soup.find(id=label_id)
            if node:
                label += ' ' + node.get_text(' ', strip=True)
        if label.strip().casefold() not in ('captions', 'transcript', 'subtitles'):
            continue
        if panel.get('hidden') is not None or panel.get('aria-hidden') == 'true':
            continue
        text = panel.get_text('\n', strip=True)
        if text:
            resources.append(Resource('captions', 'txt', 'semantic caption panel snapshot', data=text,
                                      warning='Rendered caption-panel text only; may be incomplete. No timestamps inferred.'))
    # Preserve visible chapter/text structure, explicitly a snapshot rather than a complete timeline.
    chapters = []
    for node in soup.select('[data-start]'):
        try:
            start = float(node['data-start'])
            if math.isfinite(start) and start >= 0:
                chapters.append({'start': start, 'text': node.get_text(' ', strip=True)})
        except (ValueError, TypeError):
            pass
    return resources, chapters


class Discovery:
    def __init__(self, context):
        self.context = context
        self.resources = {}
        self.stats = {'responses': 0, 'json_responses_unparsed': 0, 'inaccessible_frames': 0,
                      'caption_tracks': 0, 'encrypted_players': 0}
        self.title = 'Lecture'
        self.chapters = []
        context.on('response', self.observe)

    def add(self, resource):
        if resource:
            key = resource.url or resource.id
            old = self.resources.get(key)
            if old and resource.source == 'rendered download link':
                old.source = resource.source
            elif old is None or resource.source == 'network response':
                self.resources[key] = resource

    def observe(self, response):
        self.stats['responses'] += 1
        if not 200 <= response.status < 300:
            return
        mime = response.headers.get('content-type', '')
        if 'json' in mime:
            self.stats['json_responses_unparsed'] += 1
        self.add(classify(response.url, mime))

    async def snapshot(self, page):
        self.title = await page.title() or 'Lecture'
        for frame in page.frames:
            try:
                data = await frame.evaluate(SNAPSHOT)
                if '/Panopto/Pages/' in frame.url:
                    self.title = data['title'] or self.title
                resources, chapters = html_resources(data['html'], frame.url)
                for resource in resources:
                    self.add(resource)
                self.chapters.extend(chapters)
                for url in data['urls']:
                    self.add(classify(url, source='rendered player/resource timing'))
                self.stats['caption_tracks'] += data['tracks']
                self.stats['encrypted_players'] += data['encrypted']
                for track in data['cues']:
                    self.add(Resource('captions', 'vtt', 'loaded browser cues', data=vtt(track['cues']),
                                      language=track['language'], warning='Loaded cue snapshot; may be incomplete.'))
            except Exception:
                self.stats['inaccessible_frames'] += 1

        if self.stats['encrypted_players']:
            for resource in self.resources.values():
                if resource.kind in ('video', 'audio'):
                    resource.status = 'unsupported'
                    resource.warning = 'Encrypted browser player detected; media export is disabled for this inspection.'
