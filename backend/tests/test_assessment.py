import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from database import get_db
from dependencies import MOCK_USER_ID
from main import app
from models.exercise import GrammarError, PronunciationAssessment
from models.knowledge import KnowledgeState, Skill
from models.session import Session


class MockSession:
    def __init__(self, session_id, user_id):
        self.id = session_id
        self.user_id = user_id


class MockPronunciationAssessment:
    def __init__(self, assessment_id, session_id, overall_score, phoneme_alignment, elsa_response=None):
        self.id = assessment_id
        self.session_id = session_id
        self.overall_score = overall_score
        self.phoneme_alignment = phoneme_alignment
        self.elsa_response = elsa_response
        self.created_at = datetime.utcnow()


class MockGrammarError:
    def __init__(self, error_id, session_id, skill_tag, original, corrected, error_type):
        self.id = error_id
        self.session_id = session_id
        self.skill_tag = skill_tag
        self.original = original
        self.corrected = corrected
        self.error_type = error_type
        self.created_at = datetime.utcnow()


class MockSkill:
    def __init__(self, skill_id, name, category, description=None):
        self.id = skill_id
        self.name = name
        self.category = category
        self.description = description


class MockKnowledgeState:
    def __init__(self, state_id, user_id, skill_id, p_mastery):
        self.id = state_id
        self.user_id = user_id
        self.skill_id = skill_id
        self.p_mastery = p_mastery
        self.updated_at = datetime.utcnow()


@pytest.mark.asyncio
async def test_get_assessment_success():
    mock_db = AsyncMock()
    session_id = uuid.uuid4()
    assessment_id = uuid.uuid4()
    user_id = uuid.UUID(MOCK_USER_ID)

    mock_session = MockSession(session_id=session_id, user_id=user_id)
    mock_session_result = MagicMock()
    mock_session_result.scalar_one_or_none.return_value = mock_session

    phoneme_alignment = [
        {
            "position": 0,
            "phoneme": "hh",
            "expected": "hh",
            "actual": "hh",
            "type": "correct",
        }
    ]
    mock_assessment = MockPronunciationAssessment(
        assessment_id=assessment_id,
        session_id=session_id,
        overall_score=85.5,
        phoneme_alignment=phoneme_alignment,
        elsa_response={"score": 85.5},
    )
    mock_assessment_result = MagicMock()
    mock_assessment_result.scalar_one_or_none.return_value = mock_assessment

    mock_db.execute.side_effect = [mock_session_result, mock_assessment_result]
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(f"/api/assessments/{session_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(assessment_id)
        assert data["session_id"] == str(session_id)
        assert data["overall_score"] == 85.5
        assert len(data["phoneme_alignment"]) == 1
        assert data["phoneme_alignment"][0]["type"] == "correct"
        assert data["elsa_response"] == {"score": 85.5}
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_get_assessment_session_not_found():
    mock_db = AsyncMock()
    session_id = uuid.uuid4()

    mock_session_result = MagicMock()
    mock_session_result.scalar_one_or_none.return_value = None

    mock_db.execute.return_value = mock_session_result
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(f"/api/assessments/{session_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "会话不存在"
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_get_assessment_assessment_not_found():
    mock_db = AsyncMock()
    session_id = uuid.uuid4()
    user_id = uuid.UUID(MOCK_USER_ID)

    mock_session = MockSession(session_id=session_id, user_id=user_id)
    mock_session_result = MagicMock()
    mock_session_result.scalar_one_or_none.return_value = mock_session

    mock_assessment_result = MagicMock()
    mock_assessment_result.scalar_one_or_none.return_value = None

    mock_db.execute.side_effect = [mock_session_result, mock_assessment_result]
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(f"/api/assessments/{session_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "评估结果不存在"
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_get_grammar_errors_success():
    mock_db = AsyncMock()
    session_id = uuid.uuid4()
    user_id = uuid.UUID(MOCK_USER_ID)

    mock_session = MockSession(session_id=session_id, user_id=user_id)
    mock_session_result = MagicMock()
    mock_session_result.scalar_one_or_none.return_value = mock_session

    error1 = MockGrammarError(
        error_id=uuid.uuid4(),
        session_id=session_id,
        skill_tag="tense",
        original="I go yesterday",
        corrected="I went yesterday",
        error_type="verb_tense",
    )
    mock_errors_result = MagicMock()
    mock_errors_result.scalars.return_value.all.return_value = [error1]

    mock_db.execute.side_effect = [mock_session_result, mock_errors_result]
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(f"/api/assessments/{session_id}/grammar")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["skill_tag"] == "tense"
        assert data[0]["original"] == "I go yesterday"
        assert data[0]["corrected"] == "I went yesterday"
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_get_grammar_errors_session_not_found():
    mock_db = AsyncMock()
    session_id = uuid.uuid4()

    mock_session_result = MagicMock()
    mock_session_result.scalar_one_or_none.return_value = None

    mock_db.execute.return_value = mock_session_result
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get(f"/api/assessments/{session_id}/grammar")

        assert response.status_code == 404
        assert response.json()["detail"] == "会话不存在"
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_get_knowledge_states():
    mock_db = AsyncMock()
    user_id = uuid.UUID(MOCK_USER_ID)
    state_id = uuid.uuid4()

    mock_skill = MockSkill(skill_id="skill_1", name="Past Tense", category="Grammar")
    mock_state = MockKnowledgeState(
        state_id=state_id, user_id=user_id, skill_id="skill_1", p_mastery=0.85
    )

    mock_result = MagicMock()
    mock_result.all.return_value = [(mock_state, mock_skill)]

    mock_db.execute.return_value = mock_result
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/assessments/knowledge/states")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == str(state_id)
        assert data[0]["skill_id"] == "skill_1"
        assert data[0]["skill_name"] == "Past Tense"
        assert data[0]["skill_category"] == "Grammar"
        assert data[0]["p_mastery"] == 0.85
    finally:
        app.dependency_overrides = {}


@pytest.mark.asyncio
async def test_list_skills():
    mock_db = AsyncMock()

    mock_skill1 = MockSkill(
        skill_id="skill_1", name="Past Tense", category="Grammar", description="Simple past tense"
    )
    mock_skill2 = MockSkill(
        skill_id="skill_2", name="Present Perfect", category="Grammar", description="Present perfect tense"
    )

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [mock_skill1, mock_skill2]

    mock_db.execute.return_value = mock_result
    app.dependency_overrides[get_db] = lambda: mock_db

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/assessments/knowledge/skills")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["id"] == "skill_1"
        assert data[1]["id"] == "skill_2"
    finally:
        app.dependency_overrides = {}
