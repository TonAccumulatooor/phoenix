import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, HTTPException

router = APIRouter(prefix="/api/upload", tags=["uploads"])

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
MAX_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB


@router.post("/image")
async def upload_image(file: UploadFile):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"Invalid file type: {file.content_type}. Allowed: png, jpg, gif, webp, svg")

    data = await file.read()
    if len(data) > MAX_SIZE_BYTES:
        raise HTTPException(400, f"File too large ({len(data)} bytes). Max 2 MB.")

    ext = Path(file.filename or "img.png").suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        ext = ".png"

    filename = f"{uuid.uuid4().hex[:16]}{ext}"
    dest = UPLOAD_DIR / filename
    dest.write_bytes(data)

    return {"url": f"/api/uploads/{filename}", "filename": filename}
