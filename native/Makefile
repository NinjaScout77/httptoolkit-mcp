# Build htk-getenv native helpers for local development/testing.
# CI builds use the GitHub Actions workflow for cross-platform prebuilds.

UNAME := $(shell uname -s)
ARCH := $(shell uname -m)

ifeq ($(UNAME),Darwin)
  SRC = getenv_darwin.c
  ifeq ($(ARCH),arm64)
    TARGET_DIR = ../prebuilds/darwin-arm64
  else
    TARGET_DIR = ../prebuilds/darwin-x64
  endif
else ifeq ($(UNAME),Linux)
  SRC = getenv_linux.c
  ifeq ($(ARCH),x86_64)
    TARGET_DIR = ../prebuilds/linux-x64
  else ifeq ($(ARCH),aarch64)
    TARGET_DIR = ../prebuilds/linux-arm64
  else
    $(error Unsupported Linux architecture: $(ARCH))
  endif
else
  $(error Unsupported OS: $(UNAME))
endif

OUTPUT = $(TARGET_DIR)/htk-getenv

.PHONY: build clean

build:
	mkdir -p $(TARGET_DIR)
	$(CC) -O2 -Wall -Wextra -Werror -o $(OUTPUT) $(SRC)
	chmod 755 $(OUTPUT)

clean:
	rm -f ../prebuilds/*/htk-getenv
