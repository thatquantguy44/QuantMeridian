# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY scripts/build-collateral-wheel.py scripts/build-collateral-wheel.py
COPY services/collateral_optimizer_api/binding-manifest.json services/collateral_optimizer_api/binding-manifest.json
COPY services/collateral_optimizer_api/requirements.lock services/collateral_optimizer_api/requirements.lock
# The private token is a BuildKit secret. It is absent from the final image.
RUN --mount=type=secret,id=inventoryballast_token \
    test -s /run/secrets/inventoryballast_token && \
    printf '#!/bin/sh\ncase "$1" in *Username*) echo x-access-token;; *Password*) cat /run/secrets/inventoryballast_token;; esac\n' >/tmp/askpass && \
    chmod 700 /tmp/askpass && \
    GIT_ASKPASS=/tmp/askpass GIT_TERMINAL_PROMPT=0 git clone --filter=blob:none --no-checkout https://github.com/thatquantguy44/InventoryBallast.git /build/InventoryBallast && \
    git -C /build/InventoryBallast checkout --detach eb74850a0f972ca9e1f40558ecd7909d3e76e6b3 && \
    python scripts/build-collateral-wheel.py /build/InventoryBallast/projects/collateral_optimizer --output /build/out --require-git && \
    rm /tmp/askpass
RUN python -m venv /opt/collateral-venv && \
    /opt/collateral-venv/bin/pip install --no-cache-dir -r services/collateral_optimizer_api/requirements.lock && \
    /opt/collateral-venv/bin/pip install --no-cache-dir --no-deps /build/out/collateral_optimizer-*.whl

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /opt/collateral-venv /opt/collateral-venv
COPY --from=build /build/out/binding-attestation.json /app/binding-attestation.json
COPY services/collateral_optimizer_api /app/services/collateral_optimizer_api
ENV PATH="/opt/collateral-venv/bin:$PATH" \
    PYTHONPATH="/app/services/collateral_optimizer_api/src" \
    COLLATERAL_BINDING_ATTESTATION="/app/binding-attestation.json"
EXPOSE 8017
CMD ["uvicorn", "collateral_optimizer_api.app:app", "--host", "0.0.0.0", "--port", "8017"]
