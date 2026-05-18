#urls.py

from django.urls import path
from . import views

urlpatterns = [
    path("test", views.test_chat),
    path("process/extract", views.process_extract),
    path("process/summarize", views.process_summarize),
    path("process/folder-summaries", views.process_folder_summaries),
    path("workspace/grouped", views.workspace_grouped),
    path("ask", views.ask),
    path("workspace/unsupported", views.unsupported_files),
]


