from pathlib import Path
import httpx
from .models import safe_url


class Transport:
    """Stream bytes with URL-scoped browser cookies, never writing auth state."""
    def __init__(self, context, user_agent):
        self.context = context
        self.client = httpx.AsyncClient(follow_redirects=False, timeout=120, headers={'User-Agent': user_agent})

    async def chunks(self, url):
        if not safe_url(url):
            raise ValueError('Unsupported URL')
        cookies = await self.context.cookies([url])
        header = '; '.join(f'{c["name"]}={c["value"]}' for c in cookies)
        async with self.client.stream('GET', url, headers={'Cookie': header}) as response:
            if not 200 <= response.status_code < 300:
                raise ValueError('Request denied, redirected or failed')
            if 'text/html' in response.headers.get('content-type', ''):
                raise ValueError('Received a sign-in page instead of a resource')
            async for chunk in response.aiter_bytes(256 * 1024):
                yield chunk

    async def text(self, url, limit=10*1024*1024):
        data = bytearray()
        async for chunk in self.chunks(url):
            data.extend(chunk)
            if len(data) > limit:
                raise ValueError('Text resource exceeds limit')
        return data.decode('utf-8-sig')

    async def save(self, url, target):
        target = Path(target)
        with target.open('wb') as handle:
            async for chunk in self.chunks(url):
                handle.write(chunk)

    async def close(self):
        await self.client.aclose()
