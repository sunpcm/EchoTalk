import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from auth import CurrentUser
from database import get_db
from dependencies import get_current_user
from main import app
from models.session import Session, SessionMode, SessionStatus
from models.user import User


@pytest.mark.asyncio
async def test_session_resource_is_hidden_from_other_authenticated_user():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL is required for PostgreSQL ownership integration test")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    owner_id = uuid.uuid4()
    attacker_id = uuid.uuid4()
    session_id = uuid.uuid4()
    async with session_factory() as db:
        db.add_all(
            [
                User(id=owner_id, email=f"{owner_id}@example.test"),
                User(id=attacker_id, email=f"{attacker_id}@example.test"),
                Session(
                    id=session_id,
                    user_id=owner_id,
                    mode=SessionMode.free_talk,
                    status=SessionStatus.active,
                ),
            ]
        )
        await db.commit()

    async def override_db():
        async with session_factory() as db:
            yield db

    active_user = attacker_id

    async def override_user():
        return CurrentUser(
            id=active_user,
            email=f"{active_user}@example.test",
            issuer="https://id.example.test",
            subject=str(active_user),
        )

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            forbidden = await client.get(f"/api/sessions/{session_id}")
            assert forbidden.status_code == 404

            active_user = owner_id
            allowed = await client.get(f"/api/sessions/{session_id}")
            assert allowed.status_code == 200
            assert allowed.json()["id"] == str(session_id)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        async with session_factory() as db:
            await db.execute(delete(Session).where(Session.id == session_id))
            await db.execute(delete(User).where(User.id.in_([owner_id, attacker_id])))
            await db.commit()
        await engine.dispose()
