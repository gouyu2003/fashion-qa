"""DashScope dense embeddings and immutable local vector indexes."""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
from threading import Semaphore, Thread
from time import monotonic, sleep
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import numpy as np

from src.knowledge.corpus import digest, json_bytes
from src.model_errors import REQUEST_RETRY_POLICY, error_diagnostic
from src.observability import current_observer
from src.process_lock import process_lock

RetrievalMode = Literal['bm25', 'embedding', 'hybrid']
MODEL = 'text-embedding-v4'
DIMENSION = 1024
BATCH_SIZE = 10
ENCODING_VERSION = 'dashscope-dense-v1'
ENDPOINT_PATH = '/api/v1/services/embeddings/text-embedding/text-embedding'
_build_slot = Semaphore(1)


class EmbeddingError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def endpoint():
    base = urlsplit(os.getenv('DEEPSEEK_BASE_URL', ''))
    host = base.hostname or ''
    if base.scheme != 'https' or base.netloc != host or not (
        host.endswith('.maas.aliyuncs.com') or host in ('dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com')
    ):
        raise EmbeddingError('embedding_configuration', '向量检索需要将 DEEPSEEK_BASE_URL 配置为百炼 HTTPS 接入地址。')
    return 'https://' + host + ENDPOINT_PATH


def profile():
    return {'model': MODEL, 'dimension': DIMENSION, 'encoding_version': ENCODING_VERSION,
            'endpoint_sha256': digest(endpoint().encode())}


def _normalized(rows, count):
    vectors = np.asarray(rows, dtype=np.float32)
    if vectors.shape != (count, DIMENSION) or not np.isfinite(vectors).all():
        raise ValueError('Unexpected embedding shape or values')
    norms = np.linalg.norm(vectors.astype(np.float64), axis=1, keepdims=True)
    if (norms == 0).any():
        raise ValueError('Zero embedding')
    return (vectors / norms).astype(np.float32)


def encode(texts, text_type, usage=None, remaining=None):
    """Encode one bounded batch, reporting provider attempts separately from chat usage."""
    if os.getenv('MAQA_DISABLE_MODEL_CALLS') == '1':
        raise EmbeddingError('embedding_disabled', '当前环境已禁用模型调用。')
    key = os.getenv('DEEPSEEK_API_KEY', '').strip()
    if not key:
        raise EmbeddingError('embedding_configuration', '请在后端配置已有百炼 DEEPSEEK_API_KEY。')
    url = endpoint()
    body = {'model': MODEL, 'input': {'texts': texts},
            'parameters': {'text_type': text_type, 'dimension': DIMENSION, 'output_type': 'dense'}}
    policy = REQUEST_RETRY_POLICY
    for attempt in range(policy['max_retries'] + 1):
        timeout = min(20, remaining()) if remaining else 20
        started, tokens, succeeded = monotonic(), None, False
        retry = False
        try:
            response = httpx.post(url, headers={'Authorization': f'Bearer {key}'}, json=body, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
            tokens = payload.get('usage', {}).get('total_tokens')
            tokens = tokens if type(tokens) is int and tokens >= 0 else None
            # Native responses use output.embeddings and text_index. Accept index in
            # deployments where DashScope exposes the updated response schema.
            items = payload.get('output', payload)['embeddings']
            rows = {item.get('text_index', item.get('index')): item['embedding'] for item in items}
            if len(items) != len(texts) or set(rows) != set(range(len(texts))):
                raise ValueError('Unexpected embedding row IDs')
            result = _normalized([rows[i] for i in range(len(texts))], len(texts))
            succeeded = True
            return result
        except httpx.HTTPError as exc:
            diagnosis = error_diagnostic(exc, [key, *texts])
            retry = diagnosis['retryable'] and attempt < policy['max_retries']
            if not retry:
                status = diagnosis['http_status']
                suffix = f' HTTP {status}。' if status else ''
                raise EmbeddingError('embedding_unavailable', f'百炼向量请求失败，请检查模型授权、额度或网络。{suffix}') from None
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            raise EmbeddingError('embedding_response_invalid', '百炼返回的向量格式、数量或维度不符。') from None
        finally:
            item = {'text_type': text_type, 'input_tokens': tokens, 'failed': not succeeded,
                    'duration_ms': round((monotonic() - started) * 1000)}
            if usage is not None:
                usage.append(item)
            observer = current_observer.get()
            if observer:
                observer.emit('embedding_request', **item)
        if retry:
            delay = policy['backoff_seconds']
            if remaining and remaining() <= delay:
                raise EmbeddingError('embedding_unavailable', '向量检索的剩余时间不足以重试。')
            sleep(delay)


def evidence_key(chunk):
    if 'chunk_id' in chunk:
        return (chunk['chunk_id'],)
    return chunk['source_title'], chunk['source_paragraph']


def _rows(retriever):
    return [(evidence_key(doc), doc['text'] if retriever.is_document_corpus
             else f'{doc["source_title"]}\n{doc["text"]}') for doc in retriever.documents]


def _index_identity(retriever):
    return {**profile(), 'rows_sha256': digest(json_bytes(_rows(retriever))), 'row_count': len(retriever.documents)}


def _folder(root, identity):
    return Path(root) / digest(json_bytes(identity))


def _replace(path, write):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{uuid4().hex}.tmp')
    try:
        with temporary.open('wb') as handle:
            write(handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_json(path, content):
    _replace(path, lambda handle: handle.write(json_bytes(content)))


def _read_json(path):
    return json.loads(path.read_bytes())


def _sha256_file(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


@lru_cache(maxsize=4)
def _load_matrix(filename, sha256, count, size, modified, changed):
    path = Path(filename)
    if _sha256_file(path) != sha256:
        raise ValueError('Embedding artifact hash')
    matrix = np.load(path, allow_pickle=False)
    if matrix.shape != (count, DIMENSION) or matrix.dtype != np.float32 or not np.isfinite(matrix).all():
        raise ValueError('Embedding artifact shape')
    matrix.flags.writeable = False
    return matrix


def load_index(retriever, index):
    if not index:
        raise EmbeddingError('embedding_index_missing', '请为所选知识源版本构建向量索引。')
    identity = _index_identity(retriever)
    if not isinstance(index, dict) or any(index.get(key) != value for key, value in identity.items()):
        raise EmbeddingError('embedding_index_mismatch', '向量索引与当前语料或百炼配置不匹配，请构建索引并保存新配置。')
    try:
        path = Path(index['vector_path'])
        stat = path.stat()
        return _load_matrix(str(path), index['vector_sha256'], identity['row_count'],
                            stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    except (OSError, TypeError, ValueError, KeyError, EOFError):
        raise EmbeddingError('embedding_index_invalid', '向量索引缺失或校验失败，请重新构建索引。') from None


def find_index(root, retriever):
    folder = _folder(root, _index_identity(retriever))
    try:
        index = _read_json(folder / 'manifest.json')
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise EmbeddingError('embedding_index_invalid', '向量索引清单校验失败，请重新构建索引。') from exc
    load_index(retriever, index)
    return index


def _build(folder, identity, retriever):
    texts = [value for _, value in _rows(retriever)]
    if not texts:
        raise EmbeddingError('embedding_empty_corpus', '知识源没有可编码的证据片段。')
    attempts = []
    try:
        vectors = np.vstack([encode(texts[i:i + BATCH_SIZE], 'document', attempts)
                             for i in range(0, len(texts), BATCH_SIZE)])
        staged = folder / f'{uuid4().hex}.npy'
        try:
            _replace(staged, lambda handle: np.save(handle, vectors, allow_pickle=False))
            sha = _sha256_file(staged)
            final = folder / f'{sha}.npy'
            os.replace(staged, final)
            index = {**identity, 'vector_path': str(final.resolve()), 'vector_sha256': sha}
            load_index(retriever, index)
            _write_json(folder / 'manifest.json', index)
        finally:
            staged.unlink(missing_ok=True)
        return index
    finally:
        _write_json(folder / f'usage-{uuid4().hex}.json', summarize_usage(attempts))


def summarize_usage(attempts):
    known = [item['input_tokens'] for item in attempts if item['input_tokens'] is not None]
    return {'requests': len(attempts), 'known_input_tokens': sum(known) if known else None,
            'unknown_token_requests': len(attempts) - len(known),
            'failed_requests': sum(item['failed'] for item in attempts),
            'duration_ms': sum(item['duration_ms'] for item in attempts)}


def aggregate_usage(summaries):
    summaries = list(summaries)
    if not summaries:
        return None
    totals = {key: sum(item[key] for item in summaries)
              for key in ('requests', 'unknown_token_requests', 'failed_requests', 'duration_ms')}
    known = [item['known_input_tokens'] for item in summaries if item['known_input_tokens'] is not None]
    return {**totals, 'known_input_tokens': sum(known) if known else None}


def experiment_usage(directory, result_rows):
    builds = aggregate_usage(_read_json(path) for path in (Path(directory) / 'embeddings').glob('*/usage-*.json'))
    queries = aggregate_usage(stats for row in result_rows
                              if (stats := row.get('metrics', {}).get('timings', {}).get('embedding')))
    return {'document_builds': builds, 'queries': queries} if builds or queries else None


def prepare_index(root, retriever):
    identity = _index_identity(retriever)
    folder = _folder(root, identity)
    with process_lock(folder):
        return find_index(root, retriever) or _build(folder, identity, retriever)


def index_status(root, retriever):
    try:
        if find_index(root, retriever):
            return {'status': 'ready'}
    except EmbeddingError as exc:
        if exc.code != 'embedding_index_invalid':
            raise
        return {'status': 'failed', 'error': str(exc)}
    folder = _folder(root, _index_identity(retriever))
    state = folder / 'status.json'
    if not state.exists():
        return {'status': 'missing'}
    try:
        status = _read_json(state)
        if not isinstance(status, dict) or status.get('status') not in ('failed', 'building'):
            raise ValueError('Invalid build status')
    except (OSError, ValueError):
        return {'status': 'failed', 'error': '向量构建状态无法读取，请重试。'}
    if status['status'] != 'building':
        return status
    try:
        with process_lock(folder):
            return {'status': 'ready'} if find_index(root, retriever) else {
                'status': 'failed', 'error': '上次向量构建已中断，可以重试。'}
    except ValueError:
        return {'status': 'building'}


def start_index(root, retriever):
    identity = _index_identity(retriever)
    folder = _folder(root, identity)
    lock = process_lock(folder)
    try:
        lock.__enter__()
    except ValueError:
        return {'status': 'building'}

    def work():
        try:
            with _build_slot:
                _build(folder, identity, retriever)
        except (EmbeddingError, OSError) as exc:
            message = str(exc) if isinstance(exc, EmbeddingError) else '向量文件保存失败，请检查本地存储。'
            _write_json(folder / 'status.json', {'status': 'failed', 'error': message})
        finally:
            lock.__exit__(None, None, None)

    scheduled = False
    try:
        try:
            if find_index(root, retriever):
                return {'status': 'ready'}
        except EmbeddingError as exc:
            if exc.code != 'embedding_index_invalid':
                raise
            (folder / 'manifest.json').unlink(missing_ok=True)
        _write_json(folder / 'status.json', {'status': 'building'})
        Thread(target=work, name='embedding-index', daemon=True).start()
        scheduled = True
        return {'status': 'building'}
    finally:
        if not scheduled:
            lock.__exit__(None, None, None)


class VectorRetriever:
    """Return the original evidence rows in cosine or reciprocal-rank order."""

    def __init__(self, lexical, matrix, mode, remaining=None):
        self.lexical, self.matrix, self.mode = lexical, matrix, mode
        self.remaining = remaining
        self.is_mixed = lexical.is_mixed
        self.extract_entities = lexical.extract_entities
        self.row_by_key = {evidence_key(row): i for i, row in enumerate(lexical.documents)}

    def search(self, query, top_k=3):
        return self.search_anchored(query, [], top_k)

    def search_anchored(self, query, entity_hints, top_k=3):
        if top_k <= 0 or not query.strip():
            return []
        query_vector = encode([query], 'query', remaining=self.remaining)[0]
        scores = self.matrix @ query_vector
        ranked = np.argsort(-scores, kind='stable').tolist()
        self.lexical.prioritize_anchors(ranked, entity_hints)
        if self.mode == 'hybrid':
            candidates = max(top_k, 20)
            lexical = self.lexical.search_anchored(query, entity_hints, candidates)
            fused = {}
            for branch in (ranked[:candidates], [self.row_by_key[evidence_key(item)] for item in lexical]):
                for rank, row in enumerate(branch, 1):
                    fused[row] = fused.get(row, 0) + 1 / (60 + rank)
            ranked = sorted(fused, key=lambda row: (-fused[row], row))
            self.lexical.prioritize_anchors(ranked, entity_hints)
            scores = fused
        return [self.lexical.evidence(row, scores[row]) for row in ranked[:top_k]]
