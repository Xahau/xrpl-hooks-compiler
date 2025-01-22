all: checkout build

# Checks out submodules. Run after git clone.
# `git submodule update --init --recursive` looks like it should be
# sufficient, but actually fails to update wasi-sdk (not always but
# most of the time)...
checkout:
	git submodule update --init --recursive llvm-project
	git submodule update --init --recursive wasi-sdk
	git submodule update --init --recursive hook-cleaner-c
	git submodule update --init --recursive quickjslite
	git submodule update --init --recursive c2wasm-api/clang/includes

bin:
	mkdir $@

doc:
	mkdir $@

# Builds a docker image with (API of) clang & clangd running on port
# 9000. Run as root, on a Linux machine with docker.
build: bin
	$(MAKE) -C clang-build
	$(MAKE) -C clangd-build
	$(MAKE) -C cleaner-build
	$(MAKE) -C qjsc-build
	$(MAKE) -C docker

doc-build: doc
	$(MAKE) -C clangd-build DOC_FLAG=1 doc-clean build1 build2 doc-install

bin.zip: bin
	zip -r $@ $<

doc.zip: doc
	zip -r $@ $<

clean:
	$(MAKE) -C clang-build clean
	$(MAKE) -C clangd-build clean
	$(MAKE) -C cleaner-build clean
	$(MAKE) -C qjsc-build clean
	$(MAKE) -C docker clean
	-rm -rf bin doc
