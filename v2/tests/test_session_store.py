import pytest
from panopto_archiver.session_store import SessionStore


def backend():
    class MemoryKeychain:
        def __init__(self): self.data = {}
        def get_password(self, service, account): return self.data.get((service, account))
        def set_password(self, service, account, value): self.data[(service, account)] = value
        def delete_password(self, service, account): self.data.pop((service, account), None)
    MemoryKeychain.__module__ = 'keyring.backends.macOS'
    return MemoryKeychain()


def test_session_secret_is_scoped_and_not_saved_to_files():
    fake = backend(); store = SessionStore(fake)
    state = {'cookies': [{'name': 'session', 'value': 'fictional-secret'}], 'origins': []}
    store.save('vault-a', 'https://example.com/viewer?id=one', state)
    assert store.load('vault-a', 'https://example.com/another') == state
    assert store.load('vault-b', 'https://example.com/another') is None
    assert store.load('vault-a', 'https://other.example.com/viewer') is None
    assert 'viewer' not in repr(list(fake.data.keys()))
    store.forget('vault-a', 'https://example.com/viewer')
    assert store.load('vault-a', 'https://example.com/viewer') is None


def test_plaintext_backends_are_refused():
    class Plaintext:
        pass
    with pytest.raises(ValueError, match='OS-backed'):
        SessionStore(Plaintext())
