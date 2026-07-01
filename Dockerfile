FROM python:3.11-slim

# Устанавливаем системные зависимости для opencv-headless и mediapipe
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем зависимости
COPY requirements.txt .

# Устанавливаем Python пакеты
RUN pip install --no-cache-dir -r requirements.txt

# Копируем код
COPY . .

# Порт
EXPOSE 8080

# Запуск
CMD gunicorn app:app --workers 1 --threads 2 --timeout 120 --bind 0.0.0.0:$PORT
