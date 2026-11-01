import os
import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.knowledge import SEED_SKILLS, KnowledgeState, Skill
from routers.curriculum import _build_system_prompt_template


def _test_database_url() -> str | None:
    url = os.environ.get("DATABASE_URL")
    if url is None:
        return None
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


class _CurriculumClientContext:
    def __init__(
        self,
        session_factory,
        user_id: uuid.UUID,
        *,
        override_user: bool = True,
    ):
        self.session_factory = session_factory
        self.user_id = user_id
        self.override_user = override_user
        self.client: AsyncClient | None = None
        self._saved_overrides: dict[Any, Any] = {}

    async def __aenter__(self) -> AsyncClient:
        self._saved_overrides = {
            get_db: app.dependency_overrides.get(get_db),
            get_current_user: app.dependency_overrides.get(get_current_user),
        }

        async def override_db():
            async with self.session_factory() as db:
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        app.dependency_overrides[get_db] = override_db
        if self.override_user:

            async def override_current_user() -> CurrentUser:
                return CurrentUser(
                    id=self.user_id,
                    email=f"curriculum-{self.user_id}@example.test",
                    issuer="urn:echotalk:test",
                    subject=str(self.user_id),
                )

            app.dependency_overrides[get_current_user] = override_current_user
        else:
            app.dependency_overrides.pop(get_current_user, None)

        self.client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        )
        return self.client

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
        for dependency, saved in self._saved_overrides.items():
            if saved is None:
                app.dependency_overrides.pop(dependency, None)
            else:
                app.dependency_overrides[dependency] = saved


@pytest.fixture
async def curriculum_pg_env():
    database_url = _test_database_url()
    if database_url is None:
        pytest.skip("DATABASE_URL is required for PostgreSQL curriculum route tests")

    schema_name = f"test_curriculum_{uuid.uuid4().hex[:12]}"
    admin_engine = create_async_engine(database_url, pool_pre_ping=True)
    schema_engine = None

    try:
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema_name}"'))

        schema_engine = create_async_engine(
            database_url,
            execution_options={"schema_translate_map": {None: schema_name}},
            pool_pre_ping=True,
        )

        async with schema_engine.begin() as connection:
            await connection.execute(
                text(f'CREATE TABLE "{schema_name}".users (id UUID PRIMARY KEY)')
            )
            await connection.run_sync(Skill.__table__.create)
            await connection.run_sync(KnowledgeState.__table__.create)

        session_factory = async_sessionmaker(schema_engine, expire_on_commit=False)
        async with session_factory() as session, session.begin():
            session.add_all(Skill(**skill) for skill in SEED_SKILLS)

        class CurriculumPgEnvironment:
            async def create_user(self) -> uuid.UUID:
                user_id = uuid.uuid4()
                async with session_factory() as session, session.begin():
                    await session.execute(
                        text(
                            f'INSERT INTO "{schema_name}".users (id) '
                            "VALUES (CAST(:user_id AS UUID))"
                        ),
                        {"user_id": user_id},
                    )
                return user_id

            async def set_mastery(
                self,
                user_id: uuid.UUID,
                skill_id: str,
                mastery: float,
            ) -> None:
                async with session_factory() as session, session.begin():
                    session.add(
                        KnowledgeState(
                            user_id=user_id,
                            skill_id=skill_id,
                            p_mastery=mastery,
                        )
                    )

            def client(
                self,
                user_id: uuid.UUID,
                *,
                override_user: bool = True,
            ) -> _CurriculumClientContext:
                return _CurriculumClientContext(
                    session_factory,
                    user_id,
                    override_user=override_user,
                )

        yield CurriculumPgEnvironment()
    finally:
        if schema_engine is not None:
            await schema_engine.dispose()
        async with admin_engine.begin() as connection:
            await connection.execute(
                text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
            )
        await admin_engine.dispose()


@pytest.mark.asyncio
async def test_curriculum_defaults_without_knowledge_state(curriculum_pg_env):
    user_id = await curriculum_pg_env.create_user()

    async with curriculum_pg_env.client(user_id) as client:
        response = await client.get("/api/curriculum/next")

    assert response.status_code == 200
    payload = response.json()
    assert payload["weakest_skill"] == "verb_tense_past"
    assert payload["weakest_skill_mastery"] == 0.1
    assert payload["target_level"] == "A2"
    assert [
        recommendation["scenario_name"] for recommendation in payload["recommendations"]
    ] == [
        "business_meeting_greetings",
        "th_minimal_pairs",
        "hotel_checkin_roleplay",
    ]
    assert payload["recommendations"][0]["focus_skills"] == [
        "word_stress",
        "linking_sounds",
    ]
    assert (
        "[Scenario] Business meeting greetings:"
        in payload["recommendations"][0]["system_prompt_template"]
    )


@pytest.mark.asyncio
async def test_curriculum_is_deterministic_and_uses_skill_relevance(
    curriculum_pg_env,
):
    user_id = await curriculum_pg_env.create_user()
    await curriculum_pg_env.set_mastery(user_id, "article_usage", 0.82)

    async with curriculum_pg_env.client(user_id) as client:
        first = await client.get("/api/curriculum/next")
        second = await client.get("/api/curriculum/next")

    assert first.status_code == 200
    assert second.status_code == 200
    first_payload = first.json()
    assert first_payload == second.json()
    assert first_payload["weakest_skill"] == "article_usage"
    assert first_payload["target_level"] == "B2"
    assert [
        recommendation["scenario_name"]
        for recommendation in first_payload["recommendations"]
    ] == [
        "advanced_articles",
        "past_perfect_explanation",
        "business_presentation",
    ]
    first_recommendation = first_payload["recommendations"][0]
    assert first_recommendation["category"] == "grammar"
    assert first_recommendation["focus_skills"] == ["article_usage"]
    assert "[Target Level] CEFR B2" in first_recommendation["system_prompt_template"]
    assert (
        "- Adjust complexity to B2 level"
        in first_recommendation["system_prompt_template"]
    )


@pytest.mark.asyncio
async def test_curriculum_isolates_users_and_infers_distinct_cefr_levels(
    curriculum_pg_env,
):
    th_user_id = await curriculum_pg_env.create_user()
    article_user_id = await curriculum_pg_env.create_user()
    await curriculum_pg_env.set_mastery(th_user_id, "th_sounds", 0.2)
    await curriculum_pg_env.set_mastery(article_user_id, "article_usage", 0.8)

    async with curriculum_pg_env.client(th_user_id) as client:
        th_response = await client.get("/api/curriculum/next")
    async with curriculum_pg_env.client(article_user_id) as client:
        article_response = await client.get("/api/curriculum/next")

    assert th_response.status_code == 200
    assert article_response.status_code == 200
    th_payload = th_response.json()
    article_payload = article_response.json()
    assert th_payload["weakest_skill"] == "th_sounds"
    assert th_payload["target_level"] == "A2"
    assert th_payload["recommendations"][0]["scenario_name"] == "th_minimal_pairs"
    assert article_payload["weakest_skill"] == "article_usage"
    assert article_payload["target_level"] == "B2"
    assert article_payload["recommendations"][0]["scenario_name"] == "advanced_articles"


@pytest.mark.asyncio
async def test_curriculum_requires_authentication(curriculum_pg_env):
    user_id = await curriculum_pg_env.create_user()

    async with curriculum_pg_env.client(
        user_id,
        override_user=False,
    ) as client:
        response = await client.get("/api/curriculum/next")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_build_system_prompt_template_standard():
    scenario_name = "Coffee Shop Order"
    focus_skills = ["ordering", "polite_requests"]
    difficulty = "B1"
    material_description = "Ordering coffee at a busy cafe"

    prompt = _build_system_prompt_template(
        scenario_name=scenario_name,
        focus_skills=focus_skills,
        difficulty=difficulty,
        material_description=material_description,
    )

    expected_role_str = (
        "You are a friendly AI English coach running a "
        "'Coffee Shop Order' practice scenario."
    )
    assert expected_role_str in prompt
    assert "[Scenario] Ordering coffee at a busy cafe" in prompt
    assert "[Target Level] CEFR B1" in prompt
    assert "[Focus Skills] ordering, polite_requests" in prompt
    assert "[Instructions]" in prompt
    assert "- Adjust complexity to B1 level" in prompt


@pytest.mark.parametrize(
    "focus_skills, expected_skills_str",
    [
        ([], ""),
        (["grammar"], "grammar"),
        (
            ["fluency", "vocabulary", "pronunciation"],
            "fluency, vocabulary, pronunciation",
        ),
    ],
)
def test_build_system_prompt_template_focus_skills_variations(
    focus_skills: list[str], expected_skills_str: str
):
    prompt = _build_system_prompt_template(
        scenario_name="Job Interview",
        focus_skills=focus_skills,
        difficulty="B2",
        material_description="Answering common behavioral questions.",
    )

    assert f"[Focus Skills] {expected_skills_str}" in prompt


def test_build_system_prompt_template_multiline_and_special_chars():
    scenario_name = "Doctor's Appointment & Check-up"
    focus_skills = ["symptoms_description", "asking_questions"]
    difficulty = "A2"
    material_description = (
        "Line 1: Describing health issues.\nLine 2: Asking for prescription details."
    )

    prompt = _build_system_prompt_template(
        scenario_name=scenario_name,
        focus_skills=focus_skills,
        difficulty=difficulty,
        material_description=material_description,
    )

    assert "Doctor's Appointment & Check-up" in prompt
    assert material_description in prompt
    assert "[Target Level] CEFR A2" in prompt
    assert "- Adjust complexity to A2 level" in prompt
