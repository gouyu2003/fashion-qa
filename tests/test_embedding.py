from copy import deepcopy
from pathlib import Path
from time import monotonic, sleep

import httpx
import pytest

from src.evaluation.experiment_config import ExperimentConfig
from src.evaluation.experiment_methods import build_context, method_definition
from src.knowledge import embedding
from src.knowledge.bm25_retriever import BM25Retriever
from src.runtime.system import retriever_from_snapshot


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_BASE_URL', 'https://ws-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-key')
    monkeypatch.delenv('MAQA_DISABLE_MODEL_CALLS')
    calls = []

    def post(url, *, headers, json, timeout):
        assert url.endswith(embedding.ENDPOINT_PATH)
        assert headers['Authorization'] == 'Bearer test-key'
        assert json['model'] == 'text-embedding-v4'
        texts = json['input']['texts']
        assert len(texts) <= 10
        calls.append((json['parameters']['text_type'], texts))
        rows = []
        for index, text in enumerate(texts):
            vector = [0.] * embedding.DIMENSION
            vector[0 if 'renew' in text.lower() or '延长' in text else 1] = 1.
            rows.append({'text_index': index, 'embedding': vector})
        return httpx.Response(200, request=httpx.Request('POST', url), json={
            'output': {'embeddings': list(reversed(rows))}, 'usage': {'total_tokens': len(texts)},
        })

    monkeypatch.setattr(embedding.httpx, 'post', post)
    return calls


def test_dense_and_hybrid_share_ordered_index_and_keep_evidence(tmp_path, provider):
    lexical = BM25Retriever({'context': [['Library', ['You may renew the book.', 'A card costs $5.']],
                                          ['Museum', ['The ticket booth opens early.']]]}, source_id='qa')
    index = embedding.prepare_index(tmp_path, lexical)
    assert embedding.prepare_index(tmp_path, lexical) == index
    assert len(provider) == 1
    matrix = embedding.load_index(lexical, index)
    for mode in ('embedding', 'hybrid'):
        retriever = embedding.VectorRetriever(lexical, matrix, mode)
        hit = retriever.search('可以延长借期吗', top_k=1)[0]
        assert (hit['source_id'], hit['source_title'], hit['source_paragraph']) == ('qa', 'Library', 0)
        assert retriever.search_anchored('renew', ['Museum'], 1)[0]['source_title'] == 'Museum'
        assert len(retriever.search('renew', top_k=50)) == 3
    Path(index['vector_path']).write_bytes(b'corrupt')
    with pytest.raises(embedding.EmbeddingError, match='校验失败'):
        embedding.load_index(lexical, index)


def test_background_build_deduplicates_and_recovers(tmp_path, provider):
    lexical = BM25Retriever({'context': [['Library', ['You may renew the book.']]]})
    assert embedding.start_index(tmp_path, lexical)['status'] == 'building'
    assert embedding.start_index(tmp_path, lexical)['status'] in ('building', 'ready')
    until = monotonic() + 5
    while monotonic() < until and embedding.index_status(tmp_path, lexical)['status'] == 'building':
        sleep(.01)
    assert embedding.index_status(tmp_path, lexical)['status'] == 'ready'
    assert len(provider) == 1


def test_experiment_freezes_shared_label_free_indexes(tmp_path, monkeypatch, provider):
    from src.runtime.service import RunService
    from src.runtime.sqlite_repository import SQLiteRunRepository

    def answer(state, **kwargs):
        assert state['evidence_chunks'][0]['chunks'][0]['source_title'] == 'Library'
        return {'answer': 'Yes', 'verified': True, 'failure_type': 'none'}

    monkeypatch.setattr('src.runtime.protocol_runtime.answer_validator_fn', answer)
    old = ExperimentConfig(dataset='d', split_directory='s', output='o')
    assert old.effective_retrieval_mode == 'bm25'
    assert 'retrieval_mode' not in old.frozen_config()
    config = ExperimentConfig(schema_version=2, dataset='d', split_directory='s', output='o', top_k=4)
    assert config.frozen_config()['retrieval_mode'] == 'hybrid'
    record = {'_id': 'sample', 'question': 'Can I renew?', 'context': [['Library', ['You may renew.']]],
              'answer': 'Private gold', 'supporting_facts': [['Library', 0]]}
    sources = []
    for method in ('single_rag', 'pipeline_fixed'):
        definition = method_definition(config, method)
        context = build_context(definition, deepcopy(record), tmp_path, 'experiment', method, 'code')
        snapshot = context.config_snapshot
        sources.append(snapshot['source']['embedding_index'])
        assert snapshot['retrieval_mode'] == 'hybrid'
        assert retriever_from_snapshot(snapshot).search('renew', 1)[0]['source_paragraph'] == 0
        if method == 'single_rag':
            run = RunService(SQLiteRunRepository(tmp_path / 'runs.sqlite3')).run(context).run
            assert run.status == 'completed', run.error
            assert run.metrics.timings['embedding']['requests'] == 1
    assert sources[0] == sources[1]
    assert [call for call in provider if call[0] == 'document'] == [('document', ['Library\nYou may renew.'])]


def test_document_preview_and_published_snapshot_use_same_index(tmp_path, monkeypatch, provider):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.knowledge_api import router
    from src.knowledge.store import KnowledgeStore
    from src.runtime.system_store import SystemFailure, SystemStore

    monkeypatch.setenv('MAQA_KNOWLEDGE_DIR', str(tmp_path / 'materials'))
    store = KnowledgeStore()
    imported = store.import_files('local', 'Library', [('policy.md', b'You may renew a book.')])
    source_id = imported['source_id']
    systems = SystemStore(tmp_path / 'systems')
    fields = dict(name='Library', workflow_id='multi_hop_qa_v0', source_id=source_id,
                  source_version=1, retrieval_mode='hybrid')
    draft = systems.create(fields)
    system_id = draft['system_id']
    assert not provider
    with pytest.raises(SystemFailure):
        systems.publish(system_id, 1)

    api = FastAPI()
    api.include_router(router)
    api.state.knowledge_store = store
    with TestClient(api) as client:
        url = f'/api/v1/knowledge/sources/{source_id}/versions/1/search'
        assert client.post(url, json={'query': 'renew'}).json()['retrieval_mode'] == 'bm25'
        assert client.post(url, json={'query': 'renew', 'retrieval_mode': 'hybrid'}).status_code == 422
        build_url = '/api/v1/knowledge/embedding-index'
        selection = {'source_id': source_id, 'source_version': 1}
        assert client.post(build_url, json=selection).status_code == 202
        until = monotonic() + 5
        while monotonic() < until:
            if client.get(build_url, params=selection).json()['status'] == 'ready':
                break
            sleep(.02)
        response = client.post(url, json={'query': '延长', 'retrieval_mode': 'hybrid'})
        assert response.status_code == 200
    systems.save(system_id, 1, fields)
    release = systems.publish(system_id, 2)
    snapshot = systems.run_snapshot(system_id, version=release['version'])
    assert snapshot['retrieval_mode'] == 'hybrid'
    assert retriever_from_snapshot(snapshot).search('延长', 1)[0]['chunk_id'] == response.json()['items'][0]['chunk_id']
    assert [kind for kind, _ in provider].count('document') == 1
