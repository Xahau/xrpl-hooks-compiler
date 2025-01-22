# must be run as root

QJSC_BUILD_CONTAINER_TAG?=qjsc-build

all: build1 build2 install

build1:
	docker build -t $(QJSC_BUILD_CONTAINER_TAG) .

build2:
	docker run -v $(realpath ../quickjslite):/mnt/qjsc $(QJSC_BUILD_CONTAINER_TAG):latest

install:
	cp ../quickjslite/qjsc ../bin

clean:
	-rm -r ../quickjslite/qjsc ../quickjslite/.obj
