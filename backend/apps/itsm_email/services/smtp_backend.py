"""An SMTP email backend that authenticates with OAuth2 (XOAUTH2).

Django's stock SMTP backend only does ``LOGIN`` (username/password). Gmail and
Microsoft 365 mailboxes connected via OAuth must instead present a bearer token
with the ``AUTH XOAUTH2`` command. This subclass mirrors the stock ``open()``
but swaps the login step. The token + user are passed by ``transport`` via
``get_connection(..., oauth_user=…, oauth_token=…)``.
"""

from __future__ import annotations

import base64
from smtplib import SMTPException

from django.core.mail.backends.smtp import EmailBackend as _SmtpBackend
from django.core.mail.utils import DNS_NAME


def _xoauth2(user: str, token: str) -> str:
    raw = f"user={user}\x01auth=Bearer {token}\x01\x01".encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


class XOAuth2EmailBackend(_SmtpBackend):
    def __init__(self, *args, oauth_user: str = "", oauth_token: str = "", **kwargs):
        self.oauth_user = oauth_user
        self.oauth_token = oauth_token
        super().__init__(*args, **kwargs)

    def open(self):
        if self.connection:
            return False
        connection_params = {"local_hostname": DNS_NAME.get_fqdn()}
        if self.timeout is not None:
            connection_params["timeout"] = self.timeout
        if self.use_ssl:
            connection_params["context"] = self.ssl_context
        try:
            self.connection = self.connection_class(self.host, self.port, **connection_params)
            self.connection.ehlo()
            if not self.use_ssl and self.use_tls:
                self.connection.starttls(context=self.ssl_context)
                self.connection.ehlo()
            code, resp = self.connection.docmd(
                "AUTH", "XOAUTH2 " + _xoauth2(self.oauth_user, self.oauth_token)
            )
            if code != 235:
                raise SMTPException(f"XOAUTH2 authentication failed: {code} {resp!r}")
            return True
        except OSError:
            if not self.fail_silently:
                raise
            return False
