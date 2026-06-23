"""Chat-attachment upload (**P2**, LLM-free).

`POST /api/uploads` (multipart) stores one file under an opaque ``file_id`` and
returns it. The agent later passes that ``file_id`` (never a path) to its write
tool; the gate resolves file_id → path just-in-time at dispatch. Files live under
gitignored `uploads/` and never leave the backend.
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["uploads"])

# Homework files are small; cap uploads to guard against accidental huge files.
_MAX_BYTES = 100 * 1024 * 1024  # 100 MB


class UploadOut(BaseModel):
    file_id: str
    filename: str


@router.post("/uploads", response_model=UploadOut)
async def upload(request: Request, file: UploadFile = File(...)) -> UploadOut:
    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件过大（上限 100 MB）。")
    uploads = request.app.state.uploads
    file_id = uploads.save(content, file.filename or "upload")
    return UploadOut(file_id=file_id, filename=uploads.filename_for(file_id) or "upload")
