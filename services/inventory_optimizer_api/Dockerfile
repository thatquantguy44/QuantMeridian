FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    INVENTORY_OPTIMIZER_ENGINE_COMMIT=74737e53bf9821089c6aa2aeca5dffc4e67c81b7

RUN apt-get update \
    && apt-get install --no-install-recommends -y git=1:2.39.5-0+deb12u2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir .

USER nobody
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"]
CMD ["uvicorn", "inventory_optimizer_api.app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
