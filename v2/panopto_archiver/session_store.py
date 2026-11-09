"""Opt-in authenticated session secrets, held only in an OS-backed keyring."""
import hashlib
import json
from urllib.parse import urlsplit


class SessionStore:
    service = 'panopto-study-browser-session'

    def __init__(self, backend=None):
        if backend is None:
            import keyring
            backend = keyring.get_keyring()
        module = type(backend).__module__
        if module not in ('keyring.backends.macOS', 'keyring.backends.Windows', 'keyring.backends.SecretService', 'keyring.backends.kwallet'):
            raise ValueError('An OS-backed keychain is required; plaintext and fallback stores are refused')
        self.backend = backend

    @staticmethod
    def account(name, url):
        origin = urlsplit(url)
        return hashlib.sha256((name + '|' + origin.scheme + '://' + origin.netloc).encode()).hexdigest()

    def load(self, name, url):
        raw = self.backend.get_password(self.service, self.account(name, url))
        return json.loads(raw) if raw else None

    def save(self, name, url, state):
        self.backend.set_password(self.service, self.account(name, url), json.dumps(state))

    def forget(self, name, url):
        account = self.account(name, url)
        if self.backend.get_password(self.service, account):
            self.backend.delete_password(self.service, account)
