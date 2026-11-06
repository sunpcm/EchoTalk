FROM python:3.12-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv

# 1. 修改系统软件源为清华源，并强制 apt 使用 IPv4 防止网络解析卡死
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y ffmpeg gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

ARG BACKEND_ROLE=api

COPY pyproject.toml uv.lock .python-version ./

RUN case "$BACKEND_ROLE" in \
        api|agent) ;; \
        *) echo "BACKEND_ROLE must be 'api' or 'agent'" >&2; exit 64 ;; \
    esac && \
    uv lock --check && \
    uv sync --frozen --no-default-groups \
        --group "$BACKEND_ROLE" --no-python-downloads

COPY . .

EXPOSE 8000
