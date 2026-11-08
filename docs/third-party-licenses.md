# Third-party licenses

RESORIXtrack is `AGPL-3.0-or-later` ([LICENSING.md](../LICENSING.md)). It ships the runtime npm packages listed below in its Docker image. `scripts/licenses.ts` generates the inventory from `pnpm licenses list --prod` and fails when a package's license is outside the reviewed allow-list.

## Obligations and how they are met

| License | Obligation when distributing | How it is met |
|---|---|---|
| MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0, Python-2.0 | Keep copyright and license notice | License files ship unmodified inside `node_modules` in the image |
| Apache-2.0 | Keep license and `NOTICE`; state changes | Shipped unmodified with their files |
| MPL-2.0 | Provide source of modified MPL files | Not modified (lightningcss, build tool) |
| CC-BY-4.0 | Attribution | caniuse-lite data, used at build time |
| FSO / swisstopo geodata (free use, source required) | Name the source | Canton outlines in `src/components/app/canton-map-paths.ts`, derived from the FSO generalised boundaries 2024 (© swisstopo) as packaged by swiss-maps 4.5.0 (BSD-3-Clause, Interactive Things); the file names its source |
| SIL OFL 1.1 | Ship the font license with the font; no sale of the font alone | Inter (`@fontsource-variable/inter`) ships with its license, unmodified |
| Base image `node:26-slim` (Debian) | Debian package licenses | Unmodified official image; licenses in `/usr/share/doc/*/copyright` |
| Caddy (Apache-2.0) | As above | Optional, pulled as the unmodified official image |

None of these is a strong copyleft that reaches RESORIXtrack; all are compatible with AGPL-3.0. RESORIXtrack ships no modified third-party code.

Development tools (TypeScript, Vite, Vitest, Playwright, oxlint, Biome, drizzle-kit) are not distributed.

## Trademarks

RESORIX, RESORIXtrack and the RESORIX logos (`public/brand/`, the default email logo) are trademarks of RESORIX AG and not licensed under the AGPL. See [LICENSING.md](../LICENSING.md#trademarks).

## Keeping this page current

```bash
pnpm tsx scripts/licenses.ts --write   # after dependency changes
pnpm tsx scripts/licenses.ts --check   # allow-list check only
```

Add a license to `ALLOWED`, or a package to `REVIEWED`, in `scripts/licenses.ts` only after reading its terms.

## Package inventory

<!-- generated:start -->
519 runtime packages.

| License | Packages |
|---|---|
| MIT | 433 |
| ISC | 48 |
| BSD-3-Clause | 12 |
| Apache-2.0 | 10 |
| Unlicense | 4 |
| MPL-2.0 | 2 |
| (ISC AND CC-BY-3.0) | 1 |
| (MIT AND Zlib) | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |
| MIT-0 | 1 |
| MIT/X11 | 1 |
| PSF-2.0 | 1 |
| Python-2.0 | 1 |
| Unknown | 1 |

| Package | Version | License |
|---|---|---|
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.13 | MIT |
| @babel/generator | 7.29.13 | MIT |
| @babel/helper-compilation-targets | 7.29.13 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.13 | MIT |
| @babel/helper-string-parser | 7.29.13 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.13 | MIT |
| @babel/parser | 7.29.13 | MIT |
| @babel/runtime | 7.29.13 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.13 | MIT |
| @babel/types | 7.29.11 | MIT |
| @base-ui/react | 1.9.0 | MIT |
| @base-ui/utils | 0.5.0 | MIT |
| @better-auth/api-key | 1.7.18 | MIT |
| @better-auth/core | 1.7.18 | MIT |
| @better-auth/drizzle-adapter | 1.7.18 | MIT |
| @better-auth/kysely-adapter | 1.7.18 | MIT |
| @better-auth/memory-adapter | 1.7.18 | MIT |
| @better-auth/mongo-adapter | 1.7.18 | MIT |
| @better-auth/passkey | 1.7.18 | MIT |
| @better-auth/prisma-adapter | 1.7.18 | MIT |
| @better-auth/telemetry | 1.7.18 | MIT |
| @better-auth/utils | 0.5.1 | MIT |
| @better-fetch/fetch | 1.3.3 | MIT |
| @date-fns/tz | 1.5.0 | MIT |
| @drizzle-team/brocli | 0.10.2 | Apache-2.0 |
| @esbuild-kit/core-utils | 3.3.2 | MIT |
| @esbuild-kit/esm-loader | 2.6.5 | MIT |
| @esbuild/darwin-arm64 | 0.18.20, 0.25.12, 0.28.2 | MIT |
| @fast-csv/format | 4.3.5 | MIT |
| @fast-csv/parse | 4.3.6 | MIT |
| @floating-ui/core | 1.8.0 | MIT |
| @floating-ui/dom | 1.8.0 | MIT |
| @floating-ui/react-dom | 2.1.9 | MIT |
| @floating-ui/utils | 0.2.12 | MIT |
| @hexagon/base64 | 1.1.28 | MIT |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @levischuck/tiny-cbor | 0.2.11 | MIT |
| @noble/ciphers | 1.3.0, 2.4.0 | MIT |
| @noble/hashes | 1.8.0, 2.4.0 | MIT |
| @node-rs/argon2 | 2.2.2 | MIT |
| @node-rs/argon2-darwin-arm64 | 2.2.2 | MIT |
| @oozcitak/dom | 2.0.2 | MIT |
| @oozcitak/infra | 2.0.2 | MIT |
| @oozcitak/url | 3.0.0 | MIT |
| @oozcitak/util | 10.0.0 | MIT |
| @oxc-project/types | 0.156.0 | MIT |
| @peculiar/asn1-android | 2.11.1 | MIT |
| @peculiar/asn1-cms | 2.11.1 | MIT |
| @peculiar/asn1-csr | 2.11.1 | MIT |
| @peculiar/asn1-ecc | 2.11.1 | MIT |
| @peculiar/asn1-pfx | 2.11.1 | MIT |
| @peculiar/asn1-pkcs8 | 2.11.1 | MIT |
| @peculiar/asn1-pkcs9 | 2.11.1 | MIT |
| @peculiar/asn1-rsa | 2.11.1 | MIT |
| @peculiar/asn1-schema | 2.11.1 | MIT |
| @peculiar/asn1-x509 | 2.11.1 | MIT |
| @peculiar/asn1-x509-attr | 2.11.1 | MIT |
| @peculiar/utils | 2.0.3 | MIT |
| @peculiar/x509 | 1.14.3 | MIT |
| @radix-ui/primitive | 1.2.0 | MIT |
| @radix-ui/react-compose-refs | 1.1.5 | MIT |
| @radix-ui/react-context | 1.3.0 | MIT |
| @radix-ui/react-dialog | 1.3.1 | MIT |
| @radix-ui/react-dismissable-layer | 1.2.1 | MIT |
| @radix-ui/react-focus-guards | 1.2.0 | MIT |
| @radix-ui/react-focus-scope | 1.3.1 | MIT |
| @radix-ui/react-id | 1.1.4 | MIT |
| @radix-ui/react-portal | 1.2.0 | MIT |
| @radix-ui/react-presence | 1.1.11 | MIT |
| @radix-ui/react-primitive | 2.2.0 | MIT |
| @radix-ui/react-slot | 1.5.0 | MIT |
| @radix-ui/react-use-callback-ref | 1.1.5 | MIT |
| @radix-ui/react-use-controllable-state | 1.3.0 | MIT |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT |
| @react-pdf/fns | 3.1.3 | MIT |
| @react-pdf/font | 4.1.2 | MIT |
| @react-pdf/hyphenate | 0.1.0 | MIT |
| @react-pdf/image | 3.1.2 | MIT |
| @react-pdf/layout | 5.2.0 | MIT |
| @react-pdf/paginate | 1.0.1 | MIT |
| @react-pdf/primitives | 4.4.0 | MIT |
| @react-pdf/reconciler | 2.0.0 | MIT |
| @react-pdf/render | 4.7.0 | MIT |
| @react-pdf/renderer | 4.9.0 | MIT |
| @react-pdf/stylesheet | 6.3.2 | MIT |
| @react-pdf/svg | 1.1.1 | MIT |
| @react-pdf/textkit | 7.0.1 | MIT |
| @react-pdf/types | 2.14.0 | MIT |
| @rolldown/binding-darwin-arm64 | 1.2.16 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @simplewebauthn/browser | 13.3.0 | MIT |
| @simplewebauthn/server | 13.3.3 | MIT |
| @standard-schema/spec | 1.1.0 | MIT |
| @swc/helpers | 0.5.24 | Apache-2.0 |
| @tanstack/charts | 1.4.0 | MIT |
| @tanstack/devtools-event-client | 0.4.4 | MIT |
| @tanstack/form-core | 1.33.5 | MIT |
| @tanstack/history | 1.162.5 | MIT |
| @tanstack/pacer-lite | 0.1.1 | MIT |
| @tanstack/query-core | 5.106.1 | MIT |
| @tanstack/react-form | 1.33.5 | MIT |
| @tanstack/react-query | 5.106.1 | MIT |
| @tanstack/react-router | 1.170.46 | MIT |
| @tanstack/react-router-ssr-query | 1.167.3 | MIT |
| @tanstack/react-start | 1.169.4 | MIT |
| @tanstack/react-start-client | 1.168.44 | MIT |
| @tanstack/react-start-rsc | 0.1.65 | MIT |
| @tanstack/react-start-server | 1.167.52 | MIT |
| @tanstack/react-store | 0.11.2 | MIT |
| @tanstack/react-table | 9.3.1 | MIT |
| @tanstack/react-virtual | 3.14.26 | MIT |
| @tanstack/router-core | 1.171.39 | MIT |
| @tanstack/router-generator | 1.167.46 | MIT |
| @tanstack/router-plugin | 1.168.48 | MIT |
| @tanstack/router-ssr-query-core | 1.169.3 | MIT |
| @tanstack/router-utils | 1.162.4 | MIT |
| @tanstack/start-client-core | 1.170.39 | MIT |
| @tanstack/start-fn-stubs | 1.162.0 | MIT |
| @tanstack/start-plugin-core | 1.171.55 | MIT |
| @tanstack/start-server-core | 1.169.45 | MIT |
| @tanstack/start-storage-context | 1.167.41 | MIT |
| @tanstack/store | 0.11.2 | MIT |
| @tanstack/table-core | 9.3.1 | MIT |
| @tanstack/virtual-core | 3.19.11 | MIT |
| @tanstack/virtual-file-routes | 1.162.0 | MIT |
| @types/better-sqlite3 | 9.6.0 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/d3-force | 3.0.10 | MIT |
| @types/d3-geo | 3.1.1 | MIT |
| @types/d3-hierarchy | 3.1.7 | MIT |
| @types/d3-path | 1.0.11, 3.1.1 | MIT |
| @types/d3-sankey | 0.12.5 | MIT |
| @types/d3-shape | 1.3.12, 3.2.0 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.10 | MIT |
| @types/geojson | 7946.0.16 | MIT |
| @types/node | 14.18.63, 26.6.6 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @vitest/mocker | 5.1.0 | MIT |
| @vitest/spy | 5.1.0 | MIT |
| abs-svg-path | 0.1.1 | MIT |
| ansis | 4.5.0 | ISC |
| archiver | 5.3.2 | MIT |
| archiver-utils | 2.1.0, 3.0.4 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| argparse | 3.0.4 | PSF-2.0 |
| aria-hidden | 1.2.6 | MIT |
| array-buffer-byte-length | 1.0.2 | MIT |
| arraybuffer.prototype.slice | 1.0.4 | MIT |
| asn1js | 3.1.0 | BSD-3-Clause |
| assertion-error | 2.0.1 | MIT |
| astronomia | 4.2.0 | MIT |
| async | 3.2.6 | MIT |
| async-function | 1.0.0 | MIT |
| available-typed-arrays | 1.0.7 | MIT |
| babel-dead-code-elimination | 1.0.12 | MIT |
| balanced-match | 1.0.2 | MIT |
| base64-js | 0.0.8, 1.5.1 | MIT |
| baseline-browser-mapping | 2.11.35 | Apache-2.0 |
| better-auth | 1.7.18 | MIT |
| better-call | 1.4.5 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| bidi-js | 1.1.0 | MIT |
| big-integer | 1.6.52 | Unlicense |
| binary | 0.3.0 | MIT |
| bl | 4.1.0 | MIT |
| bluebird | 3.4.7 | MIT |
| brace-expansion | 1.1.21, 2.1.7 | MIT |
| brotli | 1.3.3 | MIT |
| browserslist | 4.29.5 | MIT |
| buffer | 5.7.1 | MIT |
| buffer-crc32 | 0.2.13 | MIT |
| buffer-from | 1.1.2 | MIT |
| buffer-indexof-polyfill | 1.0.2 | MIT |
| buffers | 0.1.1 | Unknown |
| caldate | 2.0.5 | ISC |
| call-bind | 1.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| caniuse-lite | 1.0.30001823 | CC-BY-4.0 |
| chai | 6.3.0 | MIT |
| chainsaw | 0.1.0 | MIT/X11 |
| chokidar | 5.0.0 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clone | 2.1.2 | MIT |
| clsx | 2.1.1 | MIT |
| cmdk | 1.1.1 | MIT |
| color-name | 2.1.1 | MIT |
| color-string | 2.1.4 | MIT |
| compress-commons | 4.1.2 | MIT |
| concat-map | 0.0.1 | MIT |
| convert-source-map | 2.0.0 | MIT |
| cookie-es | 3.1.1 | MIT |
| core-util-is | 1.0.3 | MIT |
| crc-32 | 1.2.2 | Apache-2.0 |
| crc32-stream | 4.0.3 | MIT |
| croner | 11.0.0 | MIT |
| csstype | 3.2.3 | MIT |
| d3-array | 3.2.4 | ISC |
| d3-array | 2.12.1 | BSD-3-Clause |
| d3-brush | 3.0.0 | ISC |
| d3-color | 3.1.1 | ISC |
| d3-contour | 4.0.2 | ISC |
| d3-delaunay | 6.0.4 | ISC |
| d3-dispatch | 3.0.2 | ISC |
| d3-drag | 3.0.1 | ISC |
| d3-ease | 3.0.2 | BSD-3-Clause |
| d3-force | 3.0.0 | ISC |
| d3-format | 3.1.3 | ISC |
| d3-geo | 3.1.1 | ISC |
| d3-hexbin | 0.2.2 | BSD-3-Clause |
| d3-hierarchy | 3.1.2 | ISC |
| d3-interpolate | 3.0.2 | ISC |
| d3-path | 3.1.1 | ISC |
| d3-path | 1.0.9 | BSD-3-Clause |
| d3-quadtree | 3.0.2 | ISC |
| d3-sankey | 0.12.3 | BSD-3-Clause |
| d3-scale | 4.0.2 | ISC |
| d3-selection | 3.0.0 | ISC |
| d3-shape | 3.2.0 | ISC |
| d3-shape | 1.3.7 | BSD-3-Clause |
| d3-time | 3.1.1 | ISC |
| d3-time-format | 4.1.1 | ISC |
| d3-timer | 3.0.2 | ISC |
| d3-transition | 3.0.2 | ISC |
| d3-zoom | 3.0.0 | ISC |
| data-view-buffer | 1.0.2 | MIT |
| data-view-byte-length | 1.0.2 | MIT |
| data-view-byte-offset | 1.0.1 | MIT |
| date-bengali-revised | 2.0.2 | MIT |
| date-chinese | 2.1.4 | MIT |
| date-easter | 1.0.3 | MIT |
| date-fns | 4.4.0 | MIT |
| date-holidays | 3.38.0 | (ISC AND CC-BY-3.0) |
| date-holidays-parser | 3.4.7 | ISC |
| dayjs | 1.11.23 | MIT |
| debug | 4.4.3 | MIT |
| deepmerge | 4.3.1 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| defu | 6.1.7 | MIT |
| delaunator | 5.1.0 | ISC |
| detect-libc | 2.1.2 | Apache-2.0 |
| detect-node-es | 1.1.0 | MIT |
| dfa | 1.2.0 | MIT |
| diff | 9.0.0 | BSD-3-Clause |
| drizzle-kit | 0.31.11 | MIT |
| drizzle-orm | 0.45.4 | Apache-2.0 |
| dunder-proto | 1.0.1 | MIT |
| duplexer2 | 0.1.4 | BSD-3-Clause |
| electron-to-chromium | 1.5.478 | ISC |
| emoji-regex-xs | 1.0.0 | MIT |
| end-of-stream | 1.4.5 | MIT |
| es-abstract | 1.24.2 | MIT |
| es-abstract-get | 1.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-module-lexer | 2.3.2 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| es-to-primitive | 1.3.4 | MIT |
| esbuild | 0.18.20, 0.25.12, 0.28.2 | MIT |
| escalade | 3.2.0 | MIT |
| estree-walker | 3.0.3 | MIT |
| events | 3.3.0 | MIT |
| exceljs | 4.4.0 | MIT |
| expect-type | 1.4.0 | Apache-2.0 |
| exsolve | 1.2.0 | MIT |
| fast-csv | 4.3.6 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fdir | 6.5.0 | MIT |
| fetchdts | 0.2.0 | MIT |
| fflate | 0.8.3 | MIT |
| fontkit | 2.0.4 | MIT |
| for-each | 0.3.5 | MIT |
| fs-constants | 1.0.0 | MIT |
| fs.realpath | 1.0.0 | ISC |
| fsevents | 2.3.3 | MIT |
| fstream | 1.0.12 | ISC |
| function-bind | 1.1.2 | MIT |
| function.prototype.name | 1.2.0 | MIT |
| functions-have-names | 1.2.3 | MIT |
| generator-function | 2.0.1 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-nonce | 1.0.1 | MIT |
| get-proto | 1.0.1 | MIT |
| get-symbol-description | 1.1.0 | MIT |
| get-tsconfig | 4.14.3 | MIT |
| glob | 7.2.3 | ISC |
| globalthis | 1.0.4 | MIT |
| gopd | 1.2.0 | MIT |
| graceful-fs | 4.2.11 | ISC |
| has-bigints | 1.1.0 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-proto | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hasown | 2.0.4 | MIT |
| hsl-to-hex | 1.0.0 | MIT |
| hsl-to-rgb-for-reals | 1.1.1 | ISC |
| hyphen | 1.6.6 | ISC |
| ieee754 | 1.2.1 | BSD-3-Clause |
| immediate | 3.0.6 | MIT |
| inflight | 1.0.6 | ISC |
| inherits | 2.0.4 | ISC |
| internal-slot | 1.1.0 | MIT |
| internmap | 1.0.1, 2.0.3 | ISC |
| is-array-buffer | 3.0.5 | MIT |
| is-async-function | 2.1.1 | MIT |
| is-bigint | 1.1.0 | MIT |
| is-boolean-object | 1.2.2 | MIT |
| is-callable | 1.2.7 | MIT |
| is-data-view | 1.0.2 | MIT |
| is-date-object | 1.1.0 | MIT |
| is-document.all | 1.0.0 | MIT |
| is-finalizationregistry | 1.1.1 | MIT |
| is-generator-function | 1.1.2 | MIT |
| is-map | 2.0.3 | MIT |
| is-negative-zero | 2.0.3 | MIT |
| is-number-object | 1.1.1 | MIT |
| is-regex | 1.2.1 | MIT |
| is-set | 2.0.3 | MIT |
| is-shared-array-buffer | 1.0.4 | MIT |
| is-string | 1.1.1 | MIT |
| is-symbol | 1.1.1 | MIT |
| is-typed-array | 1.1.15 | MIT |
| is-url | 1.2.4 | MIT |
| is-weakmap | 2.0.2 | MIT |
| is-weakref | 1.1.1 | MIT |
| is-weakset | 2.0.4 | MIT |
| isarray | 1.0.0, 2.0.5 | MIT |
| isbot | 5.2.2 | Unlicense |
| jalaali-js | 1.2.8 | MIT |
| jay-peg | 1.1.1 | MIT |
| jiti | 2.7.0 | MIT |
| jose | 6.2.15 | MIT |
| js-tokens | 4.0.0 | MIT |
| js-yaml | 4.3.2, 5.5.0 | MIT |
| jsesc | 3.1.0 | MIT |
| json5 | 2.2.3 | MIT |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| kysely | 0.29.8 | MIT |
| lazystream | 1.0.1 | MIT |
| lie | 3.3.0 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| linebreak | 1.1.0 | MIT |
| listenercount | 1.0.1 | ISC |
| lodash | 4.18.1 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.difference | 4.5.0 | MIT |
| lodash.escaperegexp | 4.1.2 | MIT |
| lodash.flatten | 4.4.0 | MIT |
| lodash.groupby | 4.6.0 | MIT |
| lodash.isboolean | 3.0.3 | MIT |
| lodash.isequal | 4.5.0 | MIT |
| lodash.isfunction | 3.0.9 | MIT |
| lodash.isnil | 4.0.0 | MIT |
| lodash.isplainobject | 4.0.6 | MIT |
| lodash.isundefined | 3.0.1 | MIT |
| lodash.union | 4.6.0 | MIT |
| lodash.uniq | 4.5.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| lru-cache | 5.1.1 | ISC |
| lucide-react | 1.70.0 | ISC |
| magic-string | 0.30.21, 1.4.5 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| media-engine | 2.0.0 | MIT |
| minimatch | 3.1.5, 5.1.9 | ISC |
| minimist | 1.2.8 | MIT |
| mkdirp | 0.5.6 | MIT |
| moment | 2.31.0 | MIT |
| moment-timezone | 0.5.48 | MIT |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.20 | MIT |
| nanostores | 1.5.5 | MIT |
| node-addon-api | 8.9.2 | MIT |
| node-releases | 2.0.63 | MIT |
| nodemailer | 10.3.1 | MIT-0 |
| normalize-path | 3.0.0 | MIT |
| normalize-svg-path | 1.1.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| object-keys | 1.1.1 | MIT |
| object.assign | 4.1.7 | MIT |
| obug | 3.0.0 | MIT |
| once | 1.4.0 | ISC |
| own-keys | 1.0.2 | MIT |
| pako | 0.2.9 | MIT |
| pako | 1.0.11 | (MIT AND Zlib) |
| parse-svg-path | 0.1.2 | MIT |
| path-is-absolute | 1.0.1 | MIT |
| pathe | 2.0.3 | MIT |
| pdfkit | 0.20.1 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| png-js | 2.0.0 | MIT |
| possible-typed-array-names | 1.1.0 | MIT |
| postcss | 8.5.32 | MIT |
| postcss-value-parser | 4.2.0 | MIT |
| prepin | 1.0.3 | Unlicense |
| prettier | 3.9.10 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| prop-types | 15.8.1 | MIT |
| pvtsutils | 1.3.6 | MIT |
| pvutils | 1.2.0 | MIT |
| queue | 6.0.2 | MIT |
| react | 19.3.1 | MIT |
| react-colorful | 5.8.1 | MIT |
| react-day-picker | 10.0.2 | MIT |
| react-dom | 19.3.1 | MIT |
| react-is | 16.13.1 | MIT |
| react-remove-scroll | 2.7.2 | MIT |
| react-remove-scroll-bar | 2.3.8 | MIT |
| react-style-singleton | 2.2.3 | MIT |
| readable-stream | 2.3.8, 3.6.2 | MIT |
| readdir-glob | 1.1.3 | Apache-2.0 |
| readdirp | 5.1.1 | MIT |
| reflect-metadata | 0.2.2 | Apache-2.0 |
| reflect.getprototypeof | 1.0.10 | MIT |
| regexp.prototype.flags | 1.5.4 | MIT |
| require-from-string | 2.0.2 | MIT |
| reselect | 5.3.0 | MIT |
| resolve-pkg-maps | 1.0.0 | MIT |
| restructure | 3.0.2 | MIT |
| rimraf | 2.7.1 | ISC |
| robust-predicates | 3.0.3 | Unlicense |
| rolldown | 1.2.16 | MIT |
| rou3 | 0.9.2 | MIT |
| safe-array-concat | 1.1.4 | MIT |
| safe-buffer | 5.1.2, 5.2.1 | MIT |
| safe-push-apply | 1.0.0 | MIT |
| safe-regex-test | 1.1.0 | MIT |
| saxes | 5.0.1 | ISC |
| scheduler | 0.25.0-rc-603e6108-20241029, 0.28.0 | MIT |
| semver | 6.3.2 | ISC |
| seroval | 1.6.12, 1.7.9 | MIT |
| seroval-plugins | 1.6.12, 1.7.8 | MIT |
| set-cookie-parser | 3.2.2 | MIT |
| set-function-length | 1.2.2 | MIT |
| set-function-name | 2.0.2 | MIT |
| set-proto | 1.0.0 | MIT |
| setimmediate | 1.0.5 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| solid-js | 1.9.18 | MIT |
| sonner | 2.0.8 | MIT |
| source-map | 0.6.1, 0.7.6 | BSD-3-Clause |
| source-map-js | 1.2.2 | BSD-3-Clause |
| source-map-support | 0.5.21 | MIT |
| srvx | 1.0.8 | MIT |
| std-env | 4.3.0 | MIT |
| stop-iteration-iterator | 1.1.0 | MIT |
| string_decoder | 1.1.1, 1.3.0 | MIT |
| string.prototype.trim | 1.2.11 | MIT |
| string.prototype.trimend | 1.0.10 | MIT |
| string.prototype.trimstart | 1.0.8 | MIT |
| svg-arc-to-cubic-bezier | 3.2.0 | ISC |
| tailwind-merge | 3.7.0 | MIT |
| tar-stream | 2.2.0 | MIT |
| tiny-inflate | 1.0.3 | MIT |
| tinybench | 6.2.3 | MIT |
| tinyexec | 1.3.1 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tmp | 0.2.7 | MIT |
| traverse | 0.3.10 | MIT |
| tslib | 1.14.1, 2.9.1 | 0BSD |
| tsx | 4.23.15 | MIT |
| tsyringe | 4.10.0 | MIT |
| typed-array-buffer | 1.0.3 | MIT |
| typed-array-byte-length | 1.0.3 | MIT |
| typed-array-byte-offset | 1.0.5 | MIT |
| typed-array-length | 1.0.8 | MIT |
| typedarray.prototype.slice | 1.0.6 | MIT |
| ufo | 1.6.4 | MIT |
| unbox-primitive | 1.1.0 | MIT |
| undici-types | 8.9.0 | MIT |
| unicode-properties | 1.4.1 | MIT |
| unicode-trie | 2.0.0 | MIT |
| unplugin | 3.7.0 | MIT |
| unzipper | 0.10.14 | MIT |
| update-browserslist-db | 1.3.4 | MIT |
| use-callback-ref | 1.3.3 | MIT |
| use-sidecar | 1.1.3 | MIT |
| use-sync-external-store | 1.7.0 | MIT |
| util-deprecate | 1.0.2 | MIT |
| uuid | 8.3.2 | MIT |
| vite | 8.3.6 | MIT |
| vitefu | 1.1.3 | MIT |
| vitest | 5.1.0 | MIT |
| webpack-virtual-modules | 0.6.2 | MIT |
| which-boxed-primitive | 1.1.1 | MIT |
| which-builtin-type | 1.2.1 | MIT |
| which-collection | 1.0.2 | MIT |
| which-typed-array | 1.1.24 | MIT |
| why-is-node-running | 3.2.1 | MIT |
| wrappy | 1.0.2 | ISC |
| xmlbuilder2 | 4.0.3 | MIT |
| xmlchars | 2.2.0 | MIT |
| yallist | 3.1.1 | ISC |
| yoga-layout | 3.2.1 | MIT |
| zip-stream | 4.1.1 | MIT |
| zod | 4.6.7 | MIT |
<!-- generated:end -->
