# syntax=docker/dockerfile:1.4
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Runtime system dependencies for image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps

# Build deps for compiling Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN mkdir -p src/zoltag && touch src/zoltag/__init__.py

# Install CPU-only PyTorch to avoid large CUDA wheels on Cloud Run.
# Pin version since latest torch may not have CPU wheels available yet.
ARG TORCH_CPU=1
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
ARG TORCH_VERSION=2.4.1
RUN if [ "$TORCH_CPU" = "1" ]; then \
    pip install torch==${TORCH_VERSION} --index-url "$TORCH_INDEX_URL"; \
  fi

# Install dependencies first (cached unless pyproject.toml changes)
RUN pip install . && \
    pip install sentencepiece

FROM base AS model-cache

COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

ENV HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers

RUN mkdir -p /app/.cache/huggingface

ARG PRELOAD_SIGLIP=0
RUN if [ "$PRELOAD_SIGLIP" = "1" ]; then \
    python3 -c "from transformers import SiglipModel, SiglipProcessor; \
    print('Downloading SigLIP model...'); \
    SiglipModel.from_pretrained('google/siglip-so400m-patch14-384'); \
    SiglipProcessor.from_pretrained('google/siglip-so400m-patch14-384'); \
    print('Model cached successfully')"; \
  fi

FROM deps AS builder

# Copy actual source and metadata
COPY src/ ./src/
COPY alembic/ ./alembic/
COPY alembic.ini ./

# Install app code without re-downloading deps
RUN pip install -e . --no-deps

FROM base AS runtime

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY src/ ./src/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY --from=model-cache /app/.cache/huggingface /app/.cache/huggingface

ENV HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers

# Create non-root user and preserve cache ownership
RUN useradd -m -u 1000 zoltag && chown -R zoltag:zoltag /app
USER zoltag

EXPOSE 8080

CMD uvicorn zoltag.api:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2
