FROM python:3.11-slim

WORKDIR /app

# 1. 修改系统软件源为清华源，并强制 apt 使用 IPv4 防止网络解析卡死
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y ffmpeg gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# 2. 为 pip 配置清华源，并增加超时时间以防大文件（如 livekit, chromadb）下载中断
RUN pip install --no-cache-dir \
    --default-timeout=100 \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    -r requirements.txt

COPY . .

EXPOSE 8000