from django.db import models


class GoogleAccount(models.Model):
    email = models.EmailField(unique=True)
    access_token = models.TextField()
    refresh_token = models.TextField()
    token_expiry = models.DateTimeField()
    scopes = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class PickedFile(models.Model):
    file_id = models.CharField(max_length=128, unique=True)
    name = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=128)
    modified_time = models.DateTimeField(null=True, blank=True)
    size_bytes = models.BigIntegerField(null=True, blank=True)
    folder_id = models.CharField(max_length=128, blank=True, default="")
    folder_path = models.CharField(max_length=2048, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["folder_path", "name"]



