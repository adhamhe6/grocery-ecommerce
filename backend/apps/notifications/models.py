from django.db import models


class DeliveryChannel(models.TextChoices):
    IN_APP = "IN_APP", "In-app only"
    EMAIL_QUEUED = "EMAIL_QUEUED", "Email queued"
    EMAIL_SENT = "EMAIL_SENT", "Email handed to mail backend"
    EMAIL_LOGGED = "EMAIL_LOGGED", "Email written to console/log (no external delivery)"
    EMAIL_FAILED = "EMAIL_FAILED", "Email failed"


class Notification(models.Model):
    user = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.CASCADE, related_name="notifications"
    )
    email = models.EmailField(blank=True, help_text="Recipient for guest orders")
    kind = models.CharField(max_length=40, db_index=True)
    title = models.CharField(max_length=160)
    body = models.TextField()
    order = models.ForeignKey(
        "orders.Order", null=True, blank=True, on_delete=models.CASCADE, related_name="notifications"
    )
    channel = models.CharField(max_length=14, choices=DeliveryChannel.choices, default=DeliveryChannel.IN_APP)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "read_at"])]
