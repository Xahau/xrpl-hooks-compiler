FROM --platform=linux/amd64 node:17-alpine AS wasi-sdk-builder
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

ARG LLVM_REPO=https://github.com/XRPLF/llvm-project
ARG LLVM_REF=4ca7eaabf2b3d617f9bb9490ac07ed4055fe80f9
ARG WASI_SDK_REPO=https://github.com/XRPLF/wasi-sdk
ARG WASI_SDK_REF=628938fa7156e3c709cb7f8fce5c01976b7d3ed4
ARG NINJA_FLAGS=
ARG BUILD_JOBS=

RUN apk --no-cache add --update bash build-base python3 cmake ninja git

RUN git init /src/llvm-project \
    && cd /src/llvm-project \
    && git remote add origin "$LLVM_REPO" \
    && git fetch --depth 1 origin "$LLVM_REF" \
    && git checkout FETCH_HEAD

RUN git init /src/wasi-sdk \
    && cd /src/wasi-sdk \
    && git remote add origin "$WASI_SDK_REPO" \
    && git fetch --depth 1 origin "$WASI_SDK_REF" \
    && git checkout FETCH_HEAD \
    && git submodule update --init --recursive --depth 1 \
    && rm -rf src/llvm-project \
    && ln -s /src/llvm-project src/llvm-project

RUN cd /src/wasi-sdk \
    && export NINJA_FLAGS="${NINJA_FLAGS:--j$(nproc)}" \
    && make build

RUN cd /src/wasi-sdk \
    && export NINJA_FLAGS="${NINJA_FLAGS:--j$(nproc)}" \
    && make strip

RUN cd /src/wasi-sdk \
    && export CMAKE_BUILD_PARALLEL_LEVEL="${BUILD_JOBS:-$(nproc)}" \
    && cmake --build /src/wasi-sdk/build/llvm --target clangd \
    && strip -s build/llvm/bin/clangd

COPY docker/rules.json docker/copy-subset.py docker/check-subset.py /tmp/
RUN python3 /tmp/copy-subset.py /tmp/rules.json /src/wasi-sdk/build/install/opt/wasi-sdk /opt/wasi-sdk \
    && python3 /tmp/check-subset.py /tmp/rules.json /opt/wasi-sdk

FROM --platform=linux/amd64 node:17-alpine AS qjsc-builder
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

ARG QJSC_REPO=https://github.com/RichardAH/quickjslite
ARG QJSC_REF=1babf223d01507049a2c6a62914346f1a5c73265

RUN apk --no-cache add --update build-base git \
    && git clone "$QJSC_REPO" /src/quickjslite \
    && cd /src/quickjslite \
    && git checkout "$QJSC_REF" \
    && make qjsc

FROM --platform=linux/amd64 node:17-alpine AS hook-cleaner-builder
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

ARG HOOK_CLEANER_REPO=https://github.com/XRPLF/hook-cleaner-c
ARG HOOK_CLEANER_REF=b856a3614c00361f108d07379f5892e7347bb994

RUN apk --no-cache add --update build-base git \
    && git clone "$HOOK_CLEANER_REPO" /src/hook-cleaner \
    && cd /src/hook-cleaner \
    && git checkout "$HOOK_CLEANER_REF" \
    && make

FROM --platform=linux/amd64 node:17-alpine AS guard-checker-builder
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

ARG GUARD_CHECKER_REPO=https://github.com/RichardAH/guard-checker
ARG GUARD_CHECKER_REF=de69e8aa054d49612dda7046962003beb88c0749

RUN apk --no-cache add --update build-base git \
    && git clone "$GUARD_CHECKER_REPO" /src/guard-checker \
    && cd /src/guard-checker \
    && git checkout "$GUARD_CHECKER_REF" \
    && make

FROM --platform=linux/amd64 node:17-alpine AS xahaud-includes
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

ARG XAHAUD_REPO=https://github.com/Xahau/xahaud
ARG XAHAUD_REF=bb244ef7729503a0317bcff0f8fdaa93ca5cb7d2

RUN apk --no-cache add --update git \
    && git clone --filter=blob:none --sparse "$XAHAUD_REPO" /src/xahaud \
    && cd /src/xahaud \
    && git checkout "$XAHAUD_REF" \
    && git sparse-checkout set hook \
    && mkdir -p /src/hook-headers \
    && cp hook/*.h /src/hook-headers/

FROM --platform=linux/amd64 node:17-alpine
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

RUN apk --no-cache add su-exec
COPY --from=wasi-sdk-builder /src/wasi-sdk/build/llvm/bin/clangd /usr/bin
WORKDIR /app
COPY --from=xahaud-includes /src/hook-headers/ ./clang/includes/
COPY compiler-api/package.json .
COPY compiler-api/yarn.lock .
COPY compiler-api/tsconfig.json .
COPY compiler-api/src ./src
COPY --from=wasi-sdk-builder /opt/wasi-sdk ./clang/wasi-sdk
COPY --from=hook-cleaner-builder /src/hook-cleaner/hook-cleaner /usr/bin
COPY --from=guard-checker-builder /src/guard-checker/guard_checker /usr/bin
COPY docker/wasm-opt /usr/bin
COPY --from=qjsc-builder /src/quickjslite/qjsc /usr/bin
COPY docker/run.sh .
ADD docker/compile_flags.txt /etc/clangd/compile_flags.txt
ADD docker/.clang-tidy /work/.clang-tidy
ADD docker/.clangd /work/.clangd
RUN cp -alf ./clang/includes /work/c && cp -alf clang/wasi-sdk/share/wasi-sysroot/include /usr && mkdir -p /usr/lib/clang/15.0.0 && cp -alf clang/wasi-sdk/lib/clang/15.0.0/include /usr/lib/clang/15.0.0
RUN addgroup -S appgroup && adduser -S appuser -G appgroup -h /app && chown appuser:appgroup /app
RUN yarn && yarn build
EXPOSE $PORT
CMD ["./run.sh", "node", "dist/index.js"]
