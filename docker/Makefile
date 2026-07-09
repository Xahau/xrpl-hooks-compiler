# must be run as root

MAIN_CONTAINER_TAG?=xrpl-hooks-compiler

build: dependencies
	docker build -t $(MAIN_CONTAINER_TAG) .

dependencies: compiler-api

run:
	docker run -p 127.0.0.1:9000:9000/tcp $(MAIN_CONTAINER_TAG):latest

shell:
	docker run -it --entrypoint=/bin/sh $(MAIN_CONTAINER_TAG):latest

compiler-api: ../compiler-api
	-rm -rf compiler-api
	cp -R ../compiler-api/src compiler-api/
	cp ../compiler-api/package.json ../compiler-api/yarn.lock ../compiler-api/tsconfig.json compiler-api/

clean:
	-rm -rf compiler-api clangd wasi-sdk hook-cleaner qjsc ../wasi-sdk.ts
