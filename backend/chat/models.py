from django.db import models
from drive.models import PickedFile


class Extraction(models.Model):
    file = models.OneToOneField(PickedFile, on_delete=models.CASCADE, related_name="extraction")
    text = models.TextField()
    char_count = models.IntegerField(default=0)
    truncated = models.BooleanField(default=False)
    source_modified_time = models.DateTimeField(null=True, blank=True)
    extracted_at = models.DateTimeField(auto_now=True)
    error = models.TextField(blank=True, default="")

    summary = models.TextField(blank=True, default="")
    summarized_at = models.DateTimeField(null=True, blank=True)


class FolderSummary(models.Model):
    folder_path = models.CharField(max_length=2048, unique=True)
    summary = models.TextField()
    file_count = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    