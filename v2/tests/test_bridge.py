import json
from pathlib import Path
import pytest
from panopto_archiver.bridge import archive
from test_browser import server


async def test_browser_bridge_session_reuse_and_secret_redaction(server, tmp_path):
    class FakeStore:
        state = None
        loads = 0
        saves = 0
        def load(self, name, url):
            self.loads += 1
            return self.state
        def save(self, name, url, state):
            self.state = state
            self.saves += 1
    store = FakeStore()
    for _ in range(2):
        events = []
        await archive({'op': 'archive', 'url': server, 'headless': True, 'rememberLogin': True,
                       'includePlayback': True, 'output': str(tmp_path), 'captureSeconds': 0.3},
                      output=events.append, receive=lambda: {'op': 'continue'}, store_factory=lambda: store)
        assert events[0]['type'] == 'login'
        result = events[-1]
        assert result['type'] == 'result'
        assert result['transcripts']
        assert all(Path(t['path']).exists() for t in result['transcripts'])
        assert 'fictional-secret' not in json.dumps(events)
        assert 'signature=private' not in json.dumps(events)
        assert 'session=fictional' not in json.dumps(events)
    assert store.loads == 2 and store.saves == 2
    assert any(c['name'] == 'session' for c in store.state['cookies'])


async def test_bridge_cancel_before_export(server, tmp_path):
    with pytest.raises(ValueError, match='Cancelled'):
        await archive({'url': server, 'headless': True, 'output': str(tmp_path)},
                      output=lambda event: None, receive=lambda: {'op': 'cancel'})
    assert not list(tmp_path.iterdir())


async def test_notes_only_capture_skips_media_downloads(server, tmp_path):
    events = []
    await archive({'url': server, 'headless': True, 'includePlayback': True,
                   'kinds': ['captions'], 'output': str(tmp_path), 'captureSeconds': 0.3},
                  output=events.append, receive=lambda: {'op': 'continue'})
    result = events[-1]
    assert result['transcripts']
    folder = Path(result['folder'])
    assert not list(folder.rglob('*.m4a'))
    assert not list(folder.rglob('*.mp4'))
    report = json.loads((folder / 'metadata/resources.json').read_text())
    assert all(r['outcome'] == 'skipped' for r in report['resources'] if r['kind'] == 'audio')
