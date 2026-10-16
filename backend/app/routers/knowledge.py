from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select

from ..config import get_settings
from ..deps import CurrentUser, DbSession, not_found
from ..models import KnowledgeChunk, KnowledgeDocument, System, iso
from ..schemas import DocumentCreate, SearchRequest
from ..services import knowledge

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def document_to_dict(document: KnowledgeDocument, chunk_count: int) -> dict:
    flat = " ".join(document.content.split())
    return {
        "id": document.id,
        "title": document.title,
        "source": document.source,
        "system_id": document.system_id,
        "preview": flat[:240] + ("…" if len(flat) > 240 else ""),
        "characters": len(document.content),
        "chunk_count": chunk_count,
        "created_at": iso(document.created_at),
    }


def _check_system(db, user_id: int, system_id: int | None) -> None:
    if system_id is None:
        return
    system = db.get(System, system_id)
    if system is None or system.user_id != user_id:
        raise HTTPException(422, "The selected system does not exist.")


@router.get("/documents")
def list_documents(db: DbSession, user: CurrentUser):
    counts = dict(
        db.execute(
            select(KnowledgeChunk.document_id, func.count(KnowledgeChunk.id)).group_by(KnowledgeChunk.document_id)
        ).all()
    )
    documents = db.scalars(
        select(KnowledgeDocument).where(KnowledgeDocument.user_id == user.id).order_by(KnowledgeDocument.id.desc())
    ).all()
    return [document_to_dict(d, counts.get(d.id, 0)) for d in documents]


@router.post("/documents", status_code=status.HTTP_201_CREATED)
def create_document(payload: DocumentCreate, db: DbSession, user: CurrentUser):
    _check_system(db, user.id, payload.system_id)
    document = knowledge.add_document(db, user.id, payload.title, payload.content, payload.source, payload.system_id)
    return document_to_dict(document, len(document.chunks))


@router.post("/documents/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    db: DbSession,
    user: CurrentUser,
    file: UploadFile = File(...),
    title: str = Form(""),
):
    limit = get_settings().max_upload_bytes
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(413, f"The file is larger than {limit // (1024 * 1024)} MB.")
    if b"\x00" in raw[:4096]:
        raise HTTPException(415, "Only text files are supported.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    if len(text.strip()) < 20:
        raise HTTPException(422, "The file contains too little text to index.")
    name = (title or "").strip() or (file.filename or "Uploaded document")
    document = knowledge.add_document(db, user.id, name[:300], text, source=file.filename or "", system_id=None)
    return document_to_dict(document, len(document.chunks))


@router.get("/documents/{document_id}")
def get_document(document_id: int, db: DbSession, user: CurrentUser):
    document = db.get(KnowledgeDocument, document_id)
    if document is None or document.user_id != user.id:
        raise not_found("Document")
    return {**document_to_dict(document, len(document.chunks)), "content": document.content}


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: int, db: DbSession, user: CurrentUser) -> Response:
    document = db.get(KnowledgeDocument, document_id)
    if document is None or document.user_id != user.id:
        raise not_found("Document")
    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/search")
def search_documents(payload: SearchRequest, db: DbSession, user: CurrentUser):
    hits = knowledge.search(db, user.id, payload.query, payload.top_k, payload.system_id)
    return [hit.as_dict() for hit in hits]
