#!/bin/sh

echo running build.sh...
set -e

# instructions from https://github.com/llvm/llvm-project/tree/main/clang-tools-extra/clangd#building-and-testing-clangd , extended for also building documentation
BUILD_JOBS=${BUILD_JOBS:-$(nproc)}
export CMAKE_BUILD_PARALLEL_LEVEL=${CMAKE_BUILD_PARALLEL_LEVEL:-$BUILD_JOBS}

export LLVM_ROOT=/mnt/llvm-project
cd $LLVM_ROOT
if [ -d build ]; then
    cd build
else
    mkdir build
    cd build
    cmake $LLVM_ROOT/llvm/ -DCMAKE_BUILD_TYPE=Release -DLLVM_ENABLE_PROJECTS="clang;clang-tools-extra" -DLLVM_ENABLE_SPHINX=ON -G Ninja
fi

if [ $DOC_FLAG -eq 1 ]; then
    cmake --build $LLVM_ROOT/build --target docs-clang-tools-html
else
    cmake --build $LLVM_ROOT/build --target clangd
    strip -s bin/clangd
    # should also run test here?
fi
