FROM python:3.12-slim-bookworm

# Any pip requirement for the InventoryBallast engine: the pinned git URL (default), a wheel
# copied into the build context (./wheels/inventory_optimizer-0.1.0-py3-none-any.whl), or
# inventory-optimizer==0.1.0 from an index pip can reach. Readiness verifies the installed code
# against capability-manifest.json whichever source is used.
ARG INVENTORY_OPTIMIZER_ENGINE="inventory-optimizer @ git+https://github.com/thatquantguy44/InventoryBallast.git@e84801b65a4d1c23b19cb34b0de1e217f6b345f9"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# git is only needed when the engine comes from a git URL.
RUN case "${INVENTORY_OPTIMIZER_ENGINE}" in \
      *git+*) apt-get update \
        && apt-get install --no-install-recommends -y git=1:2.39.5-0+deb12u2 \
        && rm -rf /var/lib/apt/lists/* ;; \
    esac

WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir . "${INVENTORY_OPTIMIZER_ENGINE}"

USER nobody
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"]
CMD ["uvicorn", "inventory_optimizer_api.app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
