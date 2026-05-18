from django.shortcuts import render

# Create your views here.
import requests
from django.conf import settings
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .processing import run_extraction, run_summarization, run_folder_summaries
from collections import defaultdict
from drive.models import PickedFile
from chat.models import Extraction, FolderSummary

from googleapiclient.discovery import build
from drive.views import _get_drive_service
from chat.extraction import SUPPORTED_MIMES


@api_view(["POST"])
def test_chat(request):
    message = (request.data.get("message") or "").strip()
    if not message:
        return Response({"error": "message is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        r = requests.post(
            f"{settings.OLLAMA_URL}/api/chat",
            json={
                "model": settings.OLLAMA_MODEL,
                "messages": [{"role": "user", "content": message}],
                "stream": False,
            },
            timeout=180,
        )
        r.raise_for_status()
        data = r.json()
        return Response({
            "content": data["message"]["content"],
            "thinking": data["message"].get("thinking"),
        })
    except requests.RequestException as e:
        return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)




@api_view(["POST"])
def process_extract(request):
    data, code = run_extraction()
    return Response(data, status=code)

@api_view(["POST"])
def process_summarize(request):
    data, code = run_summarization()
    return Response(data, status=code)

@api_view(["POST"])
def process_folder_summaries(request):
    force = bool(request.data.get("force", False))
    data, code = run_folder_summaries(force=force)
    return Response(data, status=code)




@api_view(["GET"])
def workspace_grouped(request):
    """Return picked files grouped by folder, with per-file extraction/summary status."""
    extractions_by_file = {e.file_id: e for e in Extraction.objects.select_related("file")}
    folder_summaries = {fs.folder_path: fs for fs in FolderSummary.objects.all()}

    grouped = defaultdict(list)
    for f in PickedFile.objects.all():
        ex = extractions_by_file.get(f.id)
        is_supported = f.mime_type in SUPPORTED_MIMES
        grouped[f.folder_path or "(root)"].append({
            "file_id": f.file_id,
            "name": f.name,
            "mime_type": f.mime_type,
            "modified_time": f.modified_time.isoformat() if f.modified_time else None,
            "supported": is_supported,
            "extracted": bool(ex and ex.text),
            "extract_error": ex.error if ex else "",
            "summarized": bool(ex and ex.summary),
            "char_count": ex.char_count if ex else 0,
            "truncated": ex.truncated if ex else False,
        })

    folders = []
    for path, files in sorted(grouped.items()):
        fs = folder_summaries.get(path)
        summarized_count = sum(1 for f in files if f["summarized"])
        supported_count = sum(1 for f in files if f["supported"])
        folders.append({
            "folder_path": path,
            "files": files,
            "summary": fs.summary if fs else "",
            "summary_file_count": fs.file_count if fs else 0,
            "summarized_file_count": summarized_count,
            "total_file_count": len(files),
            "supported_file_count": supported_count,
            "needs_resummary": fs is not None and fs.file_count != summarized_count,
        })

    totals = {
    "files": PickedFile.objects.count(),
    "supported_files": PickedFile.objects.filter(mime_type__in=SUPPORTED_MIMES).count(),
    "extracted": Extraction.objects.exclude(text="").count(),
    "summarized": Extraction.objects.exclude(summary="").count(),
    "folders": len(grouped),
    "folder_summaries": FolderSummary.objects.count(),
}

    return Response({"folders": folders, "totals": totals})


@api_view(["POST"])
def ask(request):
    """Free-form Q&A across folder + file summaries."""
    question = (request.data.get("question") or "").strip()
    if not question:
        return Response({"error": "question is required"}, status=400)

    # Build context: all folder summaries + all file summaries
    context_blocks = []
    for fs in FolderSummary.objects.all().order_by("folder_path"):
        block = [f"### Folder: {fs.folder_path} ({fs.file_count} files)"]
        block.append(f"{fs.summary}")
        files_in_folder = Extraction.objects.filter(
            file__folder_path=fs.folder_path
        ).exclude(summary="").select_related("file")
        for ex in files_in_folder:
            block.append(f"- {ex.file.name}: {ex.summary}")
        context_blocks.append("\n".join(block))

    # Also include any unfoldered files
    rootless = Extraction.objects.filter(file__folder_path="").exclude(summary="")
    if rootless.exists():
        block = ["### Unfoldered files"]
        for ex in rootless:
            block.append(f"- {ex.file.name}: {ex.summary}")
        context_blocks.append("\n".join(block))

    if not context_blocks:
        return Response({
            "answer": "No processed files in your workspace yet. Add files and run 'Process workspace' first.",
            "context_used": False,
        })

    context = "\n\n".join(context_blocks)
    prompt = (
        f"You are answering questions about a researcher's Google Drive workspace. "
        f"Below are summaries of every folder and file in the workspace. Use ONLY this information "
        f"to answer the question. If the answer isn't in the summaries, say so directly — don't guess. "
        f"When you reference a file or folder, name it exactly.\n\n"
        f"WORKSPACE SUMMARIES:\n{context}\n\n"
        f"QUESTION: {question}\n\n"
        f"ANSWER:"
    )

    try:
        from .processing import _call_gemma
        answer = _call_gemma(prompt, max_tokens=800)
        return Response({"answer": answer, "context_used": True,
                         "folders_in_context": len(context_blocks)})
    except Exception as e:
        return Response({"error": str(e)}, status=500)
    



@api_view(["GET"])
def unsupported_files(request):
    """List all picked files whose MIME type isn't in the extraction pipeline."""
    unsupported = []
    for f in PickedFile.objects.exclude(mime_type__in=SUPPORTED_MIMES).order_by("folder_path", "name"):
        unsupported.append({
            "file_id": f.file_id,
            "name": f.name,
            "mime_type": f.mime_type,
            "folder_path": f.folder_path or "(root)",
            "modified_time": f.modified_time.isoformat() if f.modified_time else None,
            "size_bytes": f.size_bytes,
        })

    # Hydrate with owner info from Drive API (one batch call for missing data)
    if unsupported:
        service = _get_drive_service()
        if service:
            for item in unsupported:
                try:
                    md = service.files().get(
                        fileId=item["file_id"],
                        fields="owners(displayName, emailAddress)",
                    ).execute()
                    owners = md.get("owners", [])
                    item["owner"] = owners[0].get("displayName", "") if owners else ""
                    item["owner_email"] = owners[0].get("emailAddress", "") if owners else ""
                except Exception:
                    item["owner"] = ""
                    item["owner_email"] = ""

    return Response({"files": unsupported, "count": len(unsupported)})