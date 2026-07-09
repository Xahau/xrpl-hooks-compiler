#!/bin/sh

echo running build.sh...
set -e

cd /mnt/wasi-sdk

: "${NINJA_FLAGS:=-j$(nproc)}"
export NINJA_FLAGS

if ! [ -L src/llvm-project ]; then
    ln -s /mnt/llvm-project src/llvm-project
fi

make build strip
