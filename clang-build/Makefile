# must be run as root

CLANG_BUILD_CONTAINER_TAG?=clang-build
NINJA_FLAGS?=

all: build1 build2 install

build1:
	docker build -t $(CLANG_BUILD_CONTAINER_TAG) .

build2:
	docker run -v $(realpath ../wasi-sdk):/mnt/wasi-sdk -v $(realpath ../llvm-project):/mnt/llvm-project -e NINJA_FLAGS="$(NINJA_FLAGS)" $(CLANG_BUILD_CONTAINER_TAG):latest

wasi-sdk.copy: ../wasi-sdk/build/install/opt/wasi-sdk
	if [ -d wasi-sdk ]; then rm -rf wasi-sdk; fi
	cp -a $^ .
	date > $@

wasi-sdk.filter: wasi-sdk.copy rules.json
	./copy-subset.py rules.json wasi-sdk ../bin/wasi-sdk
	./check-subset.py rules.json ../bin/wasi-sdk
	if [ -f ../wasi-sdk.ts ]; then rm ../wasi-sdk.ts; fi
	date > $@

install: wasi-sdk.filter

clean:
	-rm -rf ../wasi-sdk/build wasi-sdk wasi-sdk.copy wasi-sdk.filter
