.PHONY: test lint format coverage build restart

test:
	docker compose exec media-server pytest tests/

lint:
	docker compose exec media-server ruff check app/
	docker compose exec media-server mypy app/

format:
	docker compose exec media-server black app/
	docker compose exec media-server ruff check --fix app/

coverage:
	docker compose exec -u root media-server pytest --cov=app tests/

build:
	docker compose build

restart:
	docker compose restart media-server
