FROM python:3.11-slim

WORKDIR /app

# 依存パッケージのインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ソースコードのコピー
COPY main.py models.py pipeline.py ./

# Cloud Runは環境変数 PORT (デフォルト8080) をListenする必要があります
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}