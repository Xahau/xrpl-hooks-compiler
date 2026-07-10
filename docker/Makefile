# must be run as root

MAIN_CONTAINER_TAG?=xrpl-hooks-compiler

build: dependencies
	docker build -t $(MAIN_CONTAINER_TAG) -f Dockerfile ..

dependencies:

run:
	docker run -p 127.0.0.1:9000:9000/tcp $(MAIN_CONTAINER_TAG):latest

shell:
	docker run -it --entrypoint=/bin/sh $(MAIN_CONTAINER_TAG):latest

clean:
	-rm -rf compiler-api clangd wasi-sdk hook-cleaner qjsc ../wasi-sdk.ts
