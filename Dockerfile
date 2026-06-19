FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KOKORO_MODEL_DIR=/models \
    KOKORO_DEFAULT_VOICE=af_heart

WORKDIR /app

COPY pdf-reader/kokoro-server/requirements.txt /tmp/kokoro-requirements.txt
RUN pip install --no-cache-dir -r /tmp/kokoro-requirements.txt \
    && rm -f /tmp/kokoro-requirements.txt

COPY pdf-reader/app.js /app/pdf-reader/
COPY pdf-reader/index.html /app/pdf-reader/
COPY pdf-reader/styles.css /app/pdf-reader/
COPY pdf-reader/pdf-engine.js /app/pdf-reader/
COPY pdf-reader/vendor /app/pdf-reader/vendor
COPY pdf-reader/kokoro-server/server.py /app/server.py

EXPOSE 8880

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8880"]
