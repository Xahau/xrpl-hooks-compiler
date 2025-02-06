# XRPL Hooks compiler

This repository contains build scripts for the docker image with Hooks
C compiler and Language Server, git submodules of the projects
actually going into the image and their web API.

## Getting Started

Running `make` in this directory after checkout should produce the
image, but

1. It must be run as root (or at least an account privileged enough to
   build & run docker containers), and

2. checking out the submodules as root writes files into the .git
   directory that non-priviledged users cannot update,

so it's recommended to split the build into 2 steps:

```console
$ make checkout

# make build
```

The final container is called `xrpl-hooks-compiler` and can be run by
the `run` target of Makefile in the docker directory.

## Shortcuts

Building LLVM (twice - the current setup shares LLVM repo but not the
build directory between clang & clangd) takes hours, and might not
even work on computers with less than 8GB of memory (16GB is better),
so the LLVM binaries are maintained in releases of
[xrpl-hooks-compiler](https://github.com/XRPLF/xrpl-hooks-compiler/).
These binaries can be extracted from the file bin.zip in the top-level
directory, providing the results of running `make` in clang-build,
clangd-build and cleaner-build directories, so that running the
top-level make `build` target can be replaced by running just the
(default) make `build` target in the docker directory. This also
allows skipping the checkout of the `llvm-project`, `wasi-sdk`,
`hook-cleaner-c` and `quickjslite` submodules.

## API Wrapper or c2wasm-api

This project includes node.js endpoint where you can send c files and it will return compiled binary as a response. Development of this api happens under c2wasm-api folder. c2wasm-api folder contains README.md which has further information about the project.

## Developing c2wasm-api without building all the binaries

Make sure you have Docker installed. Clone this project. Download
latest bin.zip file from the releases of this GitHub repository, put
it project root and unzip:

```
unzip bin.zip
```

- CD to docker folder `cd docker`
- Run `make c2wasm-api && make clangd && make wasi-sdk && make hook-cleaner && make guard-checker  && make qjsc`
- Run `docker-compose build`
- Run `docker-compose up` or `docker-compose up -d`
- This should start server at port `:9000`, the actual compiling endpoint is this: [http://localhost:9000/api/build](localhost:9000/api/build). Note that it takes a while to start.
