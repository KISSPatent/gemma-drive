"""
Orchestrate extraction, summarization, and folder summaries.
Each function returns a dict suitable for JSON response with per-file status.
"""
from collections import defaultdict
from datetime import datetime, timezone
import requests
from django.conf import settings
from drive.models import PickedFile
from drive.views import _get_drive_service
from .models import Extraction, FolderSummary
from .extraction import extract, SUPPORTED_MIMES


def _call_gemma(prompt: str, max_tokens: int = 800, think: bool = False) -> str:
    """Single-shot Gemma call. Returns content, with fallback to thinking field
    if content is empty (some Ollama builds put it there)."""
    r = requests.post(
        f"{settings.OLLAMA_URL}/api/chat",
        json={
            "model": settings.OLLAMA_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "think": think,
            "options": {
                "num_predict": max_tokens,
                "num_ctx": 32768,  # 32K context — covers all your files
            },
        },
        timeout=300,
    )
    r.raise_for_status()
    data = r.json()
    content = (data.get("message", {}).get("content") or "").strip()
    if not content:
        # Some Ollama versions put the answer in 'thinking' even with think=false
        content = (data.get("message", {}).get("thinking") or "").strip()
    return content


def run_summarization():
    """Summarize all extractions that have text but no summary."""
    import sys  # for stderr logging
    results = []
    queryset = Extraction.objects.filter(error="").exclude(text="").filter(summary="")
    for ex in queryset:
        prompt = (
            f"Summarize the following document in 2-4 sentences. Focus on what the document is about, "
            f"its purpose, and any specific names, dates, or identifiers that distinguish it.\n\n"
            f"FILE NAME: {ex.file.name}\n"
            f"FOLDER: {ex.file.folder_path or '(root)'}\n\n"
            f"DOCUMENT CONTENT:\n{ex.text}"
        )
        try:
            summary = _call_gemma(prompt, max_tokens=600)

            # Log what we got so we can see what Gemma is actually returning
            print(f"[summarize] {ex.file.name}: returned {len(summary)} chars", file=sys.stderr)

            # Safety net: empty or near-empty → metadata-based fallback
            if not summary or len(summary) < 20:
                print(f"[summarize] {ex.file.name}: FALLBACK triggered (got {len(summary)} chars)", file=sys.stderr)
                summary = (
                    f"[Limited content extracted from {ex.file.name}. "
                    f"This file is in '{ex.file.folder_path or 'root'}' and contains "
                    f"{ex.char_count} characters of text — likely a visual or graphical "
                    f"document where most content is non-textual.]"
                )

            ex.summary = summary
            ex.summarized_at = datetime.now(timezone.utc)
            ex.save(update_fields=["summary", "summarized_at"])
            results.append({
                "file_id": ex.file.file_id,
                "name": ex.file.name,
                "status": "summarized",
                "summary_length": len(summary),
            })
        except Exception as e:
            print(f"[summarize] {ex.file.name}: ERROR {e}", file=sys.stderr)
            results.append({
                "file_id": ex.file.file_id,
                "name": ex.file.name,
                "status": "error",
                "error": str(e),
            })

    return {"results": results, "total": len(results)}, 200


def run_extraction():
    """Extract text for all picked files that lack a current extraction."""
    service = _get_drive_service()
    if service is None:
        return {"error": "not connected"}, 401

    results = []
    for f in PickedFile.objects.all():
        # Skip if we already have a current extraction
        existing = Extraction.objects.filter(file=f).first()
        if existing and existing.source_modified_time == f.modified_time and not existing.error:
            results.append({"file_id": f.file_id, "name": f.name, "status": "cached"})
            continue

        if f.mime_type not in SUPPORTED_MIMES:
            # Don't create an Extraction row; the file lives only in PickedFile and
            # surfaces through the "Unsupported files" panel via SUPPORTED_MIMES check.
            # Clean up any old placeholder row from when we used to create one.
            Extraction.objects.filter(file=f).delete()
            results.append({"file_id": f.file_id, "name": f.name, "status": "skipped",
                            "reason": "unsupported MIME"})
            continue

        try:
            text, truncated = extract(service, f.file_id, f.mime_type, f.name)
            Extraction.objects.update_or_create(
                file=f,
                defaults={
                    "text": text,
                    "char_count": len(text),
                    "truncated": truncated,
                    "source_modified_time": f.modified_time,
                    "error": "",
                    "summary": "",  # invalidate stale summary
                    "summarized_at": None,
                },
            )
            results.append({"file_id": f.file_id, "name": f.name, "status": "extracted",
                            "chars": len(text), "truncated": truncated})
        except Exception as e:
            Extraction.objects.update_or_create(
                file=f,
                defaults={
                    "text": "",
                    "char_count": 0,
                    "truncated": False,
                    "source_modified_time": f.modified_time,
                    "error": str(e),
                },
            )
            results.append({"file_id": f.file_id, "name": f.name, "status": "error",
                            "error": str(e)})

    return {"results": results, "total": len(results)}, 200



def run_folder_summaries(force: bool = False):
    """Generate one summary per folder path, rolling up file summaries."""
    grouped = defaultdict(list)
    for ex in Extraction.objects.exclude(summary=""):
        grouped[ex.file.folder_path or "(root)"].append(ex)

    results = []
    for folder_path, extractions in grouped.items():
        existing = FolderSummary.objects.filter(folder_path=folder_path).first()
        # Skip if folder summary is current (same file count) unless forced
        if existing and existing.file_count == len(extractions) and not force:
            results.append({"folder_path": folder_path, "status": "cached",
                            "file_count": len(extractions)})
            continue

        files_text = "\n\n".join(
            f"- {ex.file.name}: {ex.summary}" for ex in extractions
        )
        prompt = (
            f"Below are summaries of {len(extractions)} files inside the folder '{folder_path}'. "
            f"Write a single paragraph (3-5 sentences) describing what this folder is about as a whole. "
            f"Mention any common themes, key entities, or what someone would use this folder for.\n\n"
            f"FILE SUMMARIES:\n{files_text}"
        )
        try:
            summary = _call_gemma(prompt, max_tokens=500)
            FolderSummary.objects.update_or_create(
                folder_path=folder_path,
                defaults={"summary": summary, "file_count": len(extractions)},
            )
            results.append({"folder_path": folder_path, "status": "summarized",
                            "file_count": len(extractions)})
        except Exception as e:
            results.append({"folder_path": folder_path, "status": "error", "error": str(e)})

    return {"results": results, "total": len(results)}, 200
