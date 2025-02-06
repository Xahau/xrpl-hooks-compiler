# must be run as root

GUARD_CHECKER_BUILD_CONTAINER_TAG?=guard-checker-build

all: build1 build2 install

build1:
	docker build -t $(GUARD_CHECKER_BUILD_CONTAINER_TAG) .

build2:
	docker run -v $(realpath ../guard-checker):/mnt/guard-checker $(GUARD_CHECKER_BUILD_CONTAINER_TAG):latest

install:
	cp ../guard-checker/guard_checker ../bin

clean:
	-rm ../guard-checker/guard_checker
