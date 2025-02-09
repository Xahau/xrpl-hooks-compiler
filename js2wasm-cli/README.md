# JS2WasmCli

## Add .env variables

Copy the `.env.sample` to `.env`.

Update the `JS2WASM_CLI_HOST` variable

## Global Usage (For using as a cli)

Install:

`npm i -g js2wasm-cli`

Use:

`js2wasm-cli contracts build`

> This will build the `contracts` directory and output the wasm files into the `build` directory.

## SDK Usage (For using as an sdk)

`npm install js2wasm-cli`

```
import { buildDir } from "js2wasm-cli";

const dirPath = "my/path/to/hooks/root/dir"
const outDir = "my/build/wasm/directory"
await buildDir(dirPath, outDir);
```

## Development / Deployment

### Build Repo

`yarn run build`

### Build Executable Package

`pkg .`

### Publish NPM Package

`npm publish`