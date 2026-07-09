# must be run as root

MAIN_CONTAINER_TAG?=xrpl-hooks-compiler

build: dependencies
	docker build -t $(MAIN_CONTAINER_TAG) .

dependencies: wasi-sdk compiler-api clangd guard-checker

run:
	docker run -p 127.0.0.1:9000:9000/tcp $(MAIN_CONTAINER_TAG):latest

shell:
	docker run -it --entrypoint=/bin/sh $(MAIN_CONTAINER_TAG):latest

../wasi-sdk.ts: ../bin/wasi-sdk
	-rm -rf wasi-sdk
	cp -a ../bin/wasi-sdk .
	date > $@

wasi-sdk: ../wasi-sdk.ts

clangd: ../bin/clangd
	cp $< .

guard-checker: ../bin/guard_checker
	cp $< .
	chmod +x guard_checker

compiler-api: ../compiler-api
	-rm -rf compiler-api
	mkdir -p compiler-api/clang/includes
	cp -R ../compiler-api/clang/includes/hook compiler-api/clang/includes/
	cp -R ../compiler-api/src compiler-api/
	cp ../compiler-api/package.json ../compiler-api/yarn.lock ../compiler-api/tsconfig.json compiler-api/

clean:
	-rm -rf compiler-api clangd wasi-sdk hook-cleaner qjsc ../wasi-sdk.ts
