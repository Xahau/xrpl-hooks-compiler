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

FROM --platform=linux/amd64 node:17-alpine
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

RUN apk --no-cache add su-exec
COPY clangd /usr/bin
WORKDIR /app
COPY compiler-api/clang/includes/hook/*.h ./clang/includes/
COPY compiler-api/package.json .
COPY compiler-api/yarn.lock .
COPY compiler-api/tsconfig.json .
COPY compiler-api/src ./src
COPY wasi-sdk ./clang/wasi-sdk
COPY --from=hook-cleaner-builder /src/hook-cleaner/hook-cleaner /usr/bin
COPY guard_checker /usr/bin
COPY wasm-opt /usr/bin
COPY --from=qjsc-builder /src/quickjslite/qjsc /usr/bin
COPY run.sh .
ADD compile_flags.txt /etc/clangd/compile_flags.txt
ADD .clang-tidy /work/.clang-tidy
ADD .clangd /work/.clangd
RUN cp -alf ./clang/includes /work/c && cp -alf clang/wasi-sdk/share/wasi-sysroot/include /usr && mkdir -p /usr/lib/clang/15.0.0 && cp -alf clang/wasi-sdk/lib/clang/15.0.0/include /usr/lib/clang/15.0.0
RUN addgroup -S appgroup && adduser -S appuser -G appgroup -h /app && chown appuser:appgroup /app
RUN yarn && yarn build
EXPOSE $PORT
CMD ["./run.sh", "node", "dist/index.js"]
