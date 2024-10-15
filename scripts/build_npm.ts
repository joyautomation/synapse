// ex. scripts/build_npm.ts
import { build, emptyDir } from "@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: ["./index.ts"],
  importMap: "./deno.json",
  outDir: "./npm",
  typeCheck: false,
  test: false,
  shims: {
    // see JS docs for overview and more options
    deno: true,
    custom: [{
      // this is what `domException: true` does internally
      package: {
        name: "ramda",
        version: "^0.29.0",
      },
      typesPackage: {
        name: "@types/ramda",
        version: "^0.30.1",
      },
      globalNames: [],
    }, {
      package: {
        name: "pako",
        version: "^2.1.0",
      },
      typesPackage: {
        name: "@types/pako",
        version: "^2.0.3",
      },
      globalNames: [],
    }],
  },
  package: {
    // package.json properties
    name: "@joyautomation/synapse",
    version: Deno.args[0],
    description: "Joy Automation MQTT Sparkplug B Client",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/joyautomation/synapse.git",
    },
    bugs: {
      url: "https://github.com/joyautomation/synapse/issues",
    },
  },
  postBuild() {
    // steps to run after building and before running the tests
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
