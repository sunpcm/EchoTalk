"""
Celery 应用实例定义。
使用 Redis 作为消息代理和结果后端。
"""

import os

from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "echotalk",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)

# 自动发现 workers 包内的任务模块
celery_app.autodiscover_tasks(["workers"])
