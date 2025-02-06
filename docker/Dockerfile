FROM --platform=linux/amd64 node:17-alpine
MAINTAINER Vaclav Barta "vaclav@equilibrium.co"

RUN apk --no-cache add su-exec
COPY clangd /usr/bin
WORKDIR /app
COPY c2wasm-api/clang/includes/hook ./clang/includes
COPY c2wasm-api/package.json .
COPY c2wasm-api/yarn.lock .
COPY c2wasm-api/tsconfig.json .
COPY c2wasm-api/src ./src
COPY wasi-sdk ./clang/wasi-sdk
COPY hook-cleaner /usr/bin
COPY guard_checker /usr/bin
COPY wasm-opt /usr/bin
COPY qjsc /usr/bin
COPY run.sh .
ADD compile_flags.txt /etc/clangd/compile_flags.txt
ADD .clang-tidy /work/.clang-tidy
ADD .clangd /work/.clangd
RUN cp -alf ./clang/includes /work/c && cp -alf clang/wasi-sdk/share/wasi-sysroot/include /usr && mkdir -p /usr/lib/clang/15.0.0 && cp -alf clang/wasi-sdk/lib/clang/15.0.0/include /usr/lib/clang/15.0.0
RUN addgroup -S appgroup && adduser -S appuser -G appgroup -h /app && chown appuser:appgroup /app
RUN yarn && yarn build
EXPOSE $PORT
CMD ["./run.sh", "node", "dist/index.js"]
