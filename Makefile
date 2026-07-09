all: build

bin:
	mkdir $@

doc:
	mkdir $@

# Builds a docker image with (API of) clang & clangd running on port
# 9000. Run as root, on a Linux machine with docker.
build:
	$(MAKE) -C docker

bin.zip: bin
	zip -r $@ $<

doc.zip: doc
	zip -r $@ $<

clean:
	$(MAKE) -C docker clean
	-rm -rf bin doc

