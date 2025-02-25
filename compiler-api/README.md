# API that compiles C / JS code to WASM

This directory contains a webserver for a C / JS to WASM compiler and
Language Server (i.e. interactive linting).  Server is built with
[Fastify](https://www.fastify.io/), fast and low overhead framework
for Node.js

Compiling itself is done with clang (plus some hook-specific
post-processing), Language Server is clangd connected over WebSocket.


## Development

If you want to try this project follow these steps:

- Install JS dependencies by running `yarn` or `yarn install` you can use npm as well
- Install Hook API headers by running `./copyheaders.sh` as root
- Install native dependencies (wasi-sdk & clangd) as automated by the docker container construction in the parent directory and run `yarn dev` here; alternatively, just run the docker instance from ../docker

This should start server at port `:9000`, the actual compiling endpoint is this:
[http://localhost:9000/api/build](localhost:9000/api/build)

Endpoint only accepts `HTTP POST`.

You can send for example following payload to endpoint:

```json
{
  "output": "wasm",
  "compress": true,
  "files": [
    {
      "type": "c",
      "name": "file.c",
      "options": "-O3",
      "src": "#include..."
    }
  ]
}
```

Payload itself is quite self-explanatory, but the code you want to compile is under files arrays src property, you can also add some options for the compiler itself. When you POST this payload to the endpoint you should get back following response:

```json
{
  "success": true,
  "message": "Success",
  "output": "eJzUXQecVcXVv21uee/t7iv7...",
  "tasks": [
    {
      "name": "building wasm",
      "console": "",
      "success": true
    }
  ]
}
```

Output contains compiled wasm file base64 encoded.
