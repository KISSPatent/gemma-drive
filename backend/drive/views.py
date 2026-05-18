from django.shortcuts import render

# Create your views here.
import os
import secrets
from datetime import timezone, datetime
from django.http import JsonResponse, HttpResponseRedirect
from django.views.decorators.http import require_GET
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from .oauth import make_flow
from .models import GoogleAccount, PickedFile

from google.auth.transport.requests import Request as GoogleRequest

import json
from django.views.decorators.csrf import csrf_exempt

from django.core.cache import cache



@require_GET
def start(request):
    state = secrets.token_urlsafe(24)
    flow = make_flow(state=state)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    # PKCE verifier; 10-min TTL is plenty for a user to complete consent
    cache.set(f"oauth_state:{state}", flow.code_verifier, timeout=600)
    return JsonResponse({"auth_url": auth_url})

@require_GET
def callback(request):
    state = request.GET.get("state")
    cache_key = f"oauth_state:{state}"
    code_verifier = cache.get(cache_key)
    if not code_verifier:
        return JsonResponse({"error": "invalid or expired state"}, status=400)
    cache.delete(cache_key)  # one-time use

    flow = make_flow(state=state)
    flow.code_verifier = code_verifier
    code = request.GET.get("code")
    if not code:
        return JsonResponse({"error": "missing code"}, status=400)
    flow.fetch_token(code=code)


    creds = flow.credentials

    userinfo = build("oauth2", "v2", credentials=creds).userinfo().get().execute()
    email = userinfo["email"]

    GoogleAccount.objects.update_or_create(
        email=email,
        defaults={
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_expiry": creds.expiry.replace(tzinfo=timezone.utc),
            "scopes": " ".join(creds.scopes),
        },
    )
    return HttpResponseRedirect(f"{os.environ['FRONTEND_URL']}/?connected=1")

@require_GET
def status(request):
    acct = GoogleAccount.objects.first()
    if not acct:
        return JsonResponse({"connected": False})
    return JsonResponse({"connected": True, "email": acct.email})

@require_GET
def list_files(request):
    acct = GoogleAccount.objects.first()
    if not acct:
        return JsonResponse({"error": "not connected"}, status=401)
    creds = Credentials(
        token=acct.access_token,
        refresh_token=acct.refresh_token,
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=acct.scopes.split(),
    )
    service = build("drive", "v3", credentials=creds)
    results = service.files().list(
        pageSize=10,
        fields="files(id, name, mimeType, modifiedTime)",
    ).execute()
    return JsonResponse({"files": results.get("files", [])})




@require_GET
def access_token(request):
    """Return a fresh OAuth access token for the Picker (frontend-only use)."""
    acct = GoogleAccount.objects.first()
    if not acct:
        return JsonResponse({"error": "not connected"}, status=401)

    creds = Credentials(
        token=acct.access_token,
        refresh_token=acct.refresh_token,
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=acct.scopes.split(),
    )

    # Refresh if expired
    if not creds.valid:
        creds.refresh(GoogleRequest())
        acct.access_token = creds.token
        if creds.expiry:
            acct.token_expiry = creds.expiry.replace(tzinfo=timezone.utc)
        acct.save()

    return JsonResponse({"access_token": creds.token})



@csrf_exempt
def picked_files(request):
    if request.method == "GET":
        files = list(PickedFile.objects.values(
            "file_id", "name", "mime_type", "modified_time", "size_bytes"
        ))
        return JsonResponse({"files": files})

    if request.method == "POST":
        payload = json.loads(request.body)
        for f in payload.get("files", []):
            modified = f.get("modifiedTime")
            modified_dt = (
                datetime.fromisoformat(modified.replace("Z", "+00:00"))
                if modified else None
            )
            PickedFile.objects.update_or_create(
                file_id=f["id"],
                defaults={
                    "name": f.get("name", ""),
                    "mime_type": f.get("mimeType", ""),
                    "modified_time": modified_dt,
                    "size_bytes": int(f["sizeBytes"]) if f.get("sizeBytes") else None,
                    "folder_id": f.get("folderId", "") or f.get("folder_id", ""),
                    "folder_path": f.get("folderPath", "") or f.get("folder_path", ""),
                },
            )
        return JsonResponse({"ok": True, "count": PickedFile.objects.count()})

    if request.method == "DELETE":
        file_id = request.GET.get("file_id")
        if file_id:
            PickedFile.objects.filter(file_id=file_id).delete()
        else:
            PickedFile.objects.all().delete()
        return JsonResponse({"ok": True})

    return JsonResponse({"error": "method not allowed"}, status=405)

@require_GET
def picker_config(request):
    return JsonResponse({
        "api_key": os.environ["GOOGLE_PICKER_API_KEY"],
        "app_id": os.environ["GOOGLE_PROJECT_NUMBER"],
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
    })




def _get_drive_service():
    """Helper to get an authenticated Drive service."""
    acct = GoogleAccount.objects.first()
    if not acct:
        return None
    creds = Credentials(
        token=acct.access_token,
        refresh_token=acct.refresh_token,
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=acct.scopes.split(),
    )
    if not creds.valid:
        creds.refresh(GoogleRequest())
        acct.access_token = creds.token
        if creds.expiry:
            acct.token_expiry = creds.expiry.replace(tzinfo=timezone.utc)
        acct.save()
    return build("drive", "v3", credentials=creds)

@require_GET
def browse(request):
    """
    List files in a Drive folder.
    Query params:
      folder_id: parent folder ID (omit or 'root' for My Drive root)
      q: optional search query (substring match on file name)
      page_token: pagination cursor from previous response
    """
    service = _get_drive_service()
    if service is None:
        return JsonResponse({"error": "not connected"}, status=401)

    folder_id = request.GET.get("folder_id", "root")
    search = (request.GET.get("q") or "").strip()
    page_token = request.GET.get("page_token")

    # Build the Drive query string
    # https://developers.google.com/drive/api/guides/search-files
    clauses = [
        f"'{folder_id}' in parents",
        "trashed = false",
    ]
    if search:
        # Escape single quotes for Drive's query language
        safe = search.replace("'", "\\'")
        clauses.append(f"name contains '{safe}'")
    query = " and ".join(clauses)

    try:
        results = service.files().list(
            q=query,
            pageSize=50,
            pageToken=page_token,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, size, iconLink, parents)",
            orderBy="folder,name",  # folders first, then alphabetical
        ).execute()
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

    files = results.get("files", [])
    return JsonResponse({
        "files": files,
        "next_page_token": results.get("nextPageToken"),
        "folder_id": folder_id,
    })

@require_GET
def folder_path(request):
    """Resolve a folder's breadcrumb path from root."""
    folder_id = request.GET.get("folder_id", "root")
    if folder_id == "root":
        return JsonResponse({"path": [{"id": "root", "name": "My Drive"}]})

    service = _get_drive_service()
    if service is None:
        return JsonResponse({"error": "not connected"}, status=401)

    path = []
    current = folder_id
    # Walk up the parent chain (max 10 levels to avoid infinite loops)
    for _ in range(10):
        try:
            f = service.files().get(
                fileId=current,
                fields="id, name, parents",
            ).execute()
        except Exception:
            break
        path.insert(0, {"id": f["id"], "name": f["name"]})
        parents = f.get("parents", [])
        if not parents:
            break
        current = parents[0]
    path.insert(0, {"id": "root", "name": "My Drive"})
    return JsonResponse({"path": path})

def _collect_folder_files(service, root_folder_id, root_folder_name, max_files=500):
    """
    Recursively walk a folder and return all non-folder files,
    each annotated with its folder_id and folder_path (relative path from root).
    """
    collected = []
    # to_visit: list of (folder_id, path_segments)
    to_visit = [(root_folder_id, [root_folder_name])]
    visited = set()

    while to_visit and len(collected) < max_files:
        current, path_segments = to_visit.pop(0)
        if current in visited:
            continue
        visited.add(current)
        current_path = "/".join(path_segments)

        page_token = None
        while True:
            results = service.files().list(
                q=f"'{current}' in parents and trashed = false",
                pageSize=100,
                pageToken=page_token,
                fields="nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)",
            ).execute()

            for f in results.get("files", []):
                if f["mimeType"] == "application/vnd.google-apps.folder":
                    to_visit.append((f["id"], path_segments + [f["name"]]))
                else:
                    f["folder_id"] = current
                    f["folder_path"] = current_path
                    collected.append(f)
                    if len(collected) >= max_files:
                        break

            page_token = results.get("nextPageToken")
            if not page_token or len(collected) >= max_files:
                break

    return collected[:max_files]

@require_GET
def folder_contents(request):
    folder_id = request.GET.get("folder_id")
    folder_name = request.GET.get("folder_name", "Folder")
    if not folder_id:
        return JsonResponse({"error": "folder_id required"}, status=400)

    service = _get_drive_service()
    if service is None:
        return JsonResponse({"error": "not connected"}, status=401)

    try:
        files = _collect_folder_files(service, folder_id, folder_name)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"files": files, "count": len(files)})
