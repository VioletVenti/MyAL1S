"""UI direct assignment submission (**P2** implicit-confirm path, LLM-free).

`POST /api/submit` (multipart: `assignment_id` + `file`) — the user picked a file
and clicked submit, so the backend executes immediately (still matrix-gated; deny
blocks) and records an `executed`/`failed` audit row. This is the implicit-confirm
twin of the agent's two-phase approval.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

router = APIRouter(prefix="/api", tags=["submit"])

_MAX_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post("/submit")
async def submit(
    request: Request,
    assignment_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    content = await file.read()
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="文件过大（上限 100 MB）。")
    uploads = request.app.state.uploads
    file_id = uploads.save(content, file.filename or "upload")
    filename = uploads.filename_for(file_id) or file.filename or "upload"
    return await request.app.state.gate.execute_now(
        tool_name="submit_assignment",
        group_name="assignment_submission",
        args={"assignment_id": assignment_id, "file_id": file_id},
        summary=f"交作业（直接提交）: {filename}",
        filename=filename,
    )
