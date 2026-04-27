FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create uploads and data directories
RUN mkdir -p uploads /data

# SQLite DB will live on a persistent volume mounted at /data
ENV DB_PATH=/data/phoenix.db

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
