from rest_framework.authentication import SessionAuthentication


class CSRFSessionAuthentication(SessionAuthentication):
    """Session auth that enforces CSRF on unsafe methods for signed-in AND anonymous callers.

    DRF's default only checks CSRF once a session user is authenticated, which would leave login, guest
    carts and guest checkout open to cross-site POSTs. Safe methods are never checked (Django exempts them).
    """

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            self.enforce_csrf(request)
        return result
