from types import SimpleNamespace

import pytest

from apps.core.net import client_ip


def req(remote="203.0.113.9", forwarded=None):
    meta = {"REMOTE_ADDR": remote}
    if forwarded is not None:
        meta["HTTP_X_FORWARDED_FOR"] = forwarded
    return SimpleNamespace(META=meta)


def test_by_default_the_header_is_ignored_so_it_cannot_be_spoofed(settings):
    settings.TRUSTED_PROXY_COUNT = 0
    assert client_ip(req(forwarded="1.2.3.4")) == "203.0.113.9"


@pytest.mark.parametrize(
    ("trusted", "header", "expected"),
    [
        (1, "198.51.100.7", "198.51.100.7"),  # storefront proxy only: it appended the real client
        (1, "6.6.6.6, 198.51.100.7", "198.51.100.7"),  # a client-supplied prefix is ignored
        (2, "198.51.100.7, 10.0.0.5", "198.51.100.7"),  # TLS terminator + storefront proxy
        (2, "6.6.6.6, 198.51.100.7, 10.0.0.5", "198.51.100.7"),
        (3, "198.51.100.7", "198.51.100.7"),  # more trusted hops than entries: the leftmost available
    ],
)
def test_only_the_hops_we_operate_are_trusted(settings, trusted, header, expected):
    settings.TRUSTED_PROXY_COUNT = trusted
    assert client_ip(req(forwarded=header)) == expected


def test_missing_header_falls_back_to_the_socket_address(settings):
    settings.TRUSTED_PROXY_COUNT = 1
    assert client_ip(req()) == "203.0.113.9"
    assert client_ip(None) is None


def test_login_lockout_key_cannot_be_dodged_by_varying_the_forwarded_header(api, user, settings):
    settings.TRUSTED_PROXY_COUNT = 0
    codes = []
    for i in range(7):
        r = api.post(
            "/api/v1/auth/login/",
            {"email": user.email, "password": "wrong-password-1"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"9.9.9.{i}",
        )
        codes.append(r.status_code)
    assert codes[:5] == [401] * 5 and 429 in codes[5:]
