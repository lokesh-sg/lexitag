.PHONY: build version-bump sync-prod archive docker-build docker-up clean

VERSION_FILE := VERSION
ROOT_DIR := $(shell pwd)
PROD_DIR := $(ROOT_DIR)/prod
BUILDS_DIR := $(ROOT_DIR)/builds

# Read current version
CURRENT_VERSION := $(shell cat $(VERSION_FILE))

# Parse semver components
MAJOR := $(shell echo $(CURRENT_VERSION) | cut -d. -f1)
MINOR := $(shell echo $(CURRENT_VERSION) | cut -d. -f2)
PATCH := $(shell echo $(CURRENT_VERSION) | cut -d. -f3)

## build: Full build pipeline — bump version, sync to prod, commit, archive
build: version-bump sync-prod archive
	@echo "✅ Build complete: v$$(cat $(VERSION_FILE))"

## version-bump: Increment PATCH version
version-bump:
	@NEW_PATCH=$$(( $(PATCH) + 1 )); \
	NEW_VERSION="$(MAJOR).$(MINOR).$$NEW_PATCH.$(shell date +%Y%m%d.%H%M)"; \
	echo "$$NEW_VERSION" > $(VERSION_FILE); \
	echo "📦 Version bumped to $$NEW_VERSION"

## sync-prod: Rsync source → prod/ (excludes non-production files)
sync-prod:
	@echo "🔄 Syncing source → prod..."
	@mkdir -p $(PROD_DIR)
	@rsync -av --delete \
		--exclude='node_modules' \
		--exclude='__pycache__' \
		--exclude='.env' \
		--exclude='*.pyc' \
		--exclude='.DS_Store' \
		--exclude='data/' \
		--exclude='music/' \
		--exclude='prod/' \
		--exclude='builds/' \
		--exclude='backups/' \
		--exclude='tests/' \
		--exclude='.git' \
		--exclude='.agents' \
		./ $(PROD_DIR)/
	@echo "✅ Synced to $(PROD_DIR)"

## archive: Create a zip backup of prod/
archive:
	@mkdir -p $(BUILDS_DIR)
	@VERSION=$$(cat $(VERSION_FILE)); \
	cd $(ROOT_DIR) && \
	zip -r "$(BUILDS_DIR)/lexitag-v$$VERSION.zip" prod/ \
		-x "prod/node_modules/*" \
		-x "prod/__pycache__/*" && \
	echo "📁 Archive created: builds/lexitag-v$$VERSION.zip"

## docker-build: Build Docker image
docker-build:
	docker compose build

## docker-up: Start the stack
docker-up:
	docker compose up -d

## docker-down: Stop the stack
docker-down:
	docker compose down

## clean: Remove build artifacts
clean:
	rm -rf $(PROD_DIR)/*
	@echo "🧹 Cleaned prod directory"
