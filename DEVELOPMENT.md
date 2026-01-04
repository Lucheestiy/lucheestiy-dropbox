# Development Guide - Dropbox Clone

This guide explains how to set up the development environment and contribute to the project.

## Project Architecture

The project consists of several Docker containers:
- **`app` (FileBrowser)**: The core file management engine.
- **`media-server` (Flask)**: The custom API backend for gallery support, video processing, and administrative tasks.
- **`media-worker` (Celery)**: Background worker for long-running tasks like video transcoding.
- **`redis`**: Message broker for Celery and caching layer for the media server.
- **`dropbox` (Nginx)**: The frontend web server and reverse proxy.

## Prerequisites

- Docker and Docker Compose
- Node.js 22+ (for frontend development)
- Python 3.11+ (for local backend development/linting)

## Getting Started

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-repo/dropbox.lucheestiy.com.git
    cd dropbox.lucheestiy.com
    ```

2.  **Environment Setup**:
    Copy `.env.example` to `.env` and fill in the required variables.
    ```bash
    cp .env.example .env
    ```

3.  **Start the Stack**:
    Use the provided `Makefile` or `docker compose` directly.
    ```bash
    make build
    docker compose up -d
    ```

4.  **Frontend Development**:
    The frontend is located in the `nginx/` directory and built with Vite.
    ```bash
    cd nginx
    npm install
    npm run dev
    ```

5.  **Backend Development**:
    The backend is in `media-server/`.
    ```bash
    cd media-server
    # It's recommended to use the virtual environment created by the Docker build or create a local one:
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt -r requirements-dev.txt
    ```

## Development Workflow

### Code Standards

We use automated tools to ensure code quality:

**Backend (Python)**:
- **Ruff**: For linting and import sorting.
- **Black**: For code formatting.
- **Mypy**: For static type checking.

Run them via:
```bash
make lint    # Runs ruff and mypy
make format  # Runs black and ruff --fix
```

**Frontend (TypeScript)**:
- **ESLint**: For linting.
- **Prettier**: For formatting.

Run them via:
```bash
cd nginx
npm run lint
npm run format
```

### Testing

**Backend Tests**:
We use `pytest`. Coverage is tracked with `pytest-cov`.
```bash
make test      # Run all tests
make coverage  # Run tests and show coverage report
```

**Frontend Tests**:
We use `vitest`.
```bash
cd nginx
npm run test
```

## Adding New Features

1.  Check `IMPROVEMENT_PLAN.md` for current priorities.
2.  If adding a backend API, create a new blueprint in `media-server/app/routes/`.
3.  If adding frontend logic, create a new service or component in `nginx/src/`.
4.  Always add unit tests for new logic.
5.  Run linting and formatting before committing.

## Deployment

Deployment is handled via Docker. Use `safe_rebuild_droppr.sh` to safely rebuild and restart the stack in production.
```bash
./safe_rebuild_droppr.sh --clean
```
