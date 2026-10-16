"""Document chunking and keyword-similarity retrieval over the user's knowledge base.

Retrieval uses TF-IDF with cosine similarity (scikit-learn). It runs fully offline and needs
no model download; it matches vocabulary, not meaning, which is stated in the UI note.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import KnowledgeChunk, KnowledgeDocument

CHUNK_CHARS = 900
CHUNK_OVERLAP = 120
MIN_SCORE = 0.02
_WORD = re.compile(r"[a-z0-9]{2,}")


def _analyzer(text: str) -> list[str]:
    """Lower-case words without stop words, with plural endings folded (lines -> line)."""
    tokens = []
    for word in _WORD.findall(text.lower()):
        if word in ENGLISH_STOP_WORDS:
            continue
        if len(word) > 4 and word.endswith("ies"):
            word = word[:-3] + "y"
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        tokens.append(word)
    return tokens


@dataclass
class Hit:
    document_id: int
    title: str
    text: str
    score: float

    def as_dict(self) -> dict:
        return {"document_id": self.document_id, "title": self.title, "text": self.text, "score": round(self.score, 4)}


def chunk_text(text: str) -> list[str]:
    """Split on paragraph boundaries into ~900 character passages with a small overlap."""
    text = re.sub(r"\r\n?", "\n", text).strip()
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        # Very long paragraphs are split on sentence ends, then hard-wrapped as a last resort.
        pieces = [paragraph]
        if len(paragraph) > CHUNK_CHARS:
            pieces = [s.strip() for s in re.split(r"(?<=[.!?])\s+", paragraph) if s.strip()]
        for piece in pieces:
            while len(piece) > CHUNK_CHARS:
                if current:
                    chunks.append(current)
                    current = ""
                chunks.append(piece[:CHUNK_CHARS])
                piece = piece[CHUNK_CHARS - CHUNK_OVERLAP :]
            if len(current) + len(piece) + 1 > CHUNK_CHARS and current:
                chunks.append(current)
                current = current[-CHUNK_OVERLAP:] + " " + piece if CHUNK_OVERLAP else piece
            else:
                current = f"{current}\n{piece}".strip()
    if current.strip():
        chunks.append(current.strip())
    return chunks or ([text] if text else [])


def add_document(db: Session, user_id: int, title: str, content: str, source: str, system_id: int | None) -> KnowledgeDocument:
    document = KnowledgeDocument(
        user_id=user_id, system_id=system_id, title=title.strip(), source=(source or "").strip(), content=content.strip()
    )
    document.chunks = [KnowledgeChunk(position=index, text=text) for index, text in enumerate(chunk_text(content))]
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def search(db: Session, user_id: int, query: str, top_k: int = 5, system_id: int | None = None) -> list[Hit]:
    stmt = (
        select(KnowledgeChunk, KnowledgeDocument)
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .where(KnowledgeDocument.user_id == user_id)
    )
    if system_id is not None:
        stmt = stmt.where(or_(KnowledgeDocument.system_id.is_(None), KnowledgeDocument.system_id == system_id))
    rows = db.execute(stmt).all()
    query = query.strip()
    if not rows or not query:
        return []

    texts = [chunk.text for chunk, _doc in rows]
    try:
        vectorizer = TfidfVectorizer(analyzer=_analyzer, sublinear_tf=True)
        matrix = vectorizer.fit_transform(texts + [query])
    except ValueError:  # only stop words / empty vocabulary
        return []
    scores = linear_kernel(matrix[-1], matrix[:-1]).ravel()

    ranked = sorted(range(len(rows)), key=lambda i: scores[i], reverse=True)
    hits: list[Hit] = []
    seen_documents: dict[int, int] = {}
    for index in ranked:
        if scores[index] < MIN_SCORE or len(hits) >= top_k:
            break
        chunk, document = rows[index]
        # At most two passages per document so one long file cannot crowd out the rest.
        if seen_documents.get(document.id, 0) >= 2:
            continue
        seen_documents[document.id] = seen_documents.get(document.id, 0) + 1
        hits.append(Hit(document.id, document.title, chunk.text, float(scores[index])))
    return hits
