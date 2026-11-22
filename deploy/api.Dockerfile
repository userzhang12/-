FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY api/requirements.txt ./api/requirements.txt
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
    pip install --no-cache-dir -r api/requirements.txt \
    && useradd --create-home --uid 10001 jingxu && install -d -o jingxu -g jingxu /data
COPY --chown=jingxu:jingxu api ./api
ENV JINGXU_DATA=/data
USER jingxu
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
