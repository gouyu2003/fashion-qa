"""Bounded multipart imports and previews of local user knowledge."""
from __future__ import annotations

from typing import Annotated
import os

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from src.knowledge.corpus import MAX_FILE_BYTES, MAX_FILES, ImportFailure
from src.knowledge.embedding import EmbeddingError, RetrievalMode, index_status, start_index
from src.knowledge.store import KnowledgeStore, embedding_root
from src.runtime.system import DEFAULT_CATALOG_PATH, lexical_retriever, pin_source_embedding, resolve_system, retriever_from_snapshot

router = APIRouter(prefix="/api/v1/knowledge")


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=50, strict=True)
    retrieval_mode: RetrievalMode = 'bm25'

    @field_validator('query')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('请输入检索问题。')
        return value.strip()


@router.post('/sources/{source_id}/versions/{version}/search')
def search_source(source_id: str, version: int, body: SearchRequest, request: Request):
    try:
        source = get_store(request).resolve(scope(), source_id, version)
        source['source_type'] = 'document_corpus'
        if body.retrieval_mode != 'bm25':
            pin_source_embedding(source, required=True)
        retriever = retriever_from_snapshot({'source': source, 'retrieval_mode': body.retrieval_mode})
        score_type = {'bm25': 'BM25', 'embedding': '余弦', 'hybrid': 'RRF'}[body.retrieval_mode]
        return {'query': body.query, 'source_id': source_id, 'version': version,
                'index_version': source['index_version'], 'tokenizer': source['tokenizer'],
                'retrieval_mode': body.retrieval_mode, 'score_type': score_type,
                'items': retriever.search(body.query, top_k=body.top_k), 'top_k': body.top_k}
    except EmbeddingError as exc:
        raise HTTPException(status_code=422, detail={'code': exc.code, 'message': str(exc)}) from exc
    except ImportFailure as exc:
        raise HTTPException(status_code=404 if exc.code in {'source_not_found', 'version_not_ready'} else 422,
                            detail={'code': exc.code, 'message': str(exc)}) from exc


class EmbeddingSource(BaseModel):
    source_id: str = Field(min_length=1, max_length=120)
    source_version: int | None = Field(default=None, ge=1, strict=True)


def embedding_source(source_id, source_version):
    try:
        snapshot = resolve_system(source_id=source_id, source_version=source_version,
                                  catalog_path=os.getenv('MAQA_SYSTEM_CONFIG_PATH') or DEFAULT_CATALOG_PATH).snapshot()
        return lexical_retriever(snapshot['source'])
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get('/embedding-index')
def embedding_index_status(source_id: str, source_version: int | None = Query(default=None, ge=1)):
    retriever = embedding_source(source_id, source_version)
    try:
        return index_status(embedding_root(), retriever)
    except EmbeddingError as exc:
        return {'status': 'failed', 'error': str(exc)}


@router.post('/embedding-index', status_code=202)
def build_embedding_index(body: EmbeddingSource):
    retriever = embedding_source(body.source_id, body.source_version)
    try:
        return start_index(embedding_root(), retriever)
    except EmbeddingError as exc:
        raise HTTPException(status_code=422, detail={'code': exc.code, 'message': str(exc)}) from exc


def scope() -> str:
    # Legacy store signatures retain the first argument for CLI compatibility;
    # knowledge belongs to this local workspace, independent of any QA system.
    return 'local'


def get_store(request: Request) -> KnowledgeStore:
    return request.app.state.knowledge_store


def import_result(result: dict):
    if result["status"] == "failed":
        version = result["versions"][0]
        return JSONResponse(status_code=422, content={"detail": {
            "source_id": result["source_id"], "version": version["version"],
            **version["error"],
        }})
    return result


def upload_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    # Oversize reads are capped; the importer records a failed version.
    if len(files) > MAX_FILES:
        return [(file.filename or "", b"") for file in files[:MAX_FILES + 1]]
    return [(file.filename or "", file.file.read(MAX_FILE_BYTES + 1)) for file in files]


@router.post("/sources")
def create_source(request: Request, name: Annotated[str, Form()], files: Annotated[list[UploadFile], File()]):
    try:
        return import_result(get_store(request).import_files(scope(), name, upload_files(files)))
    except ImportFailure as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc


@router.get("/sources")
def list_sources(request: Request):
    return {"items": get_store(request).list_sources(scope())}


@router.get("/sources/{source_id}")
def source_detail(source_id: str, request: Request):
    try:
        return get_store(request).detail(scope(), source_id)
    except ImportFailure as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": str(exc)}) from exc


@router.delete("/sources/{source_id}")
def delete_source(source_id: str, request: Request):
    try:
        get_store(request).delete_source(scope(), source_id)
        return {"source_id": source_id, "deleted": True}
    except ImportFailure as exc:
        raise HTTPException(status_code=409 if exc.code == "source_importing" else 404,
                            detail={"code": exc.code, "message": str(exc)}) from exc


@router.post("/sources/{source_id}/versions")
def add_version(source_id: str, request: Request, files: Annotated[list[UploadFile], File()]):
    try:
        return import_result(get_store(request).import_files(scope(), None, upload_files(files), source_id))
    except ImportFailure as exc:
        raise HTTPException(status_code=404 if exc.code == "source_not_found" else 422,
                            detail={"code": exc.code, "message": str(exc)}) from exc


@router.get("/sources/{source_id}/versions/{version}/chunks")
def source_chunks(source_id: str, version: int, request: Request,
                  limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    try:
        return get_store(request).chunks(scope(), source_id, version, limit, offset)
    except ImportFailure as exc:
        raise HTTPException(status_code=404 if exc.code in {"source_not_found", "version_not_ready"} else 422,
                            detail={"code": exc.code, "message": str(exc)}) from exc
