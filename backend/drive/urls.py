from django.urls import path
from . import views

urlpatterns = [
    path("auth/google/start", views.start),
    path("auth/google/callback", views.callback),
    path("auth/status", views.status),
    path("auth/google/token", views.access_token),
    path("drive/list", views.list_files),
    path("drive/picker-config", views.picker_config),
    path("drive/picked", views.picked_files),
    path("drive/browse", views.browse),         # new
    path("drive/path", views.folder_path),      # new
    path("drive/folder-contents", views.folder_contents),
]