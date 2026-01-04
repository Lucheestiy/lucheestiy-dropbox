FROM python:3.11-slim

WORKDIR /app

# Install dependencies
# ffmpeg: for video thumbnail generation
# exiftool: for EXIF metadata extraction
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libimage-exiftool-perl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

COPY . .

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--threads", "2", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
