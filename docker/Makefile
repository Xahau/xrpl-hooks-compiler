# must be run as root

MAIN_CONTAINER_TAG?=xrpl-hooks-compiler

build: dependencies
	docker build -t $(MAIN_CONTAINER_TAG) .

dependencies: wasi-sdk c2wasm-api clangd hook-cleaner qjsc

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

hook-cleaner: ../bin/hook-cleaner
	cp $< .

c2wasm-api: ../c2wasm-api
	cp -LR $< .

qjsc: ../bin/qjsc
	cp $< .

clean:
	-rm -rf c2wasm-api clangd wasi-sdk hook-cleaner qjsc ../wasi-sdk.ts
