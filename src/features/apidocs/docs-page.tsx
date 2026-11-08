/**
 * REST API reference rendered from our own OpenAPI document (no Swagger bundle, no CDN): endpoints grouped by
 * tag, scope per endpoint, parameters, request and response schemas, an example curl call, and the schemas.
 */
import { Link } from "@tanstack/react-router"
import { Check, ChevronRight, Copy, Download, KeyRound } from "lucide-react"
import { Fragment, type ReactNode, useState } from "react"
import { CompanyLogo } from "@/components/app/logo"
import { Page, PageHeader, Section } from "@/components/app/page"
import { StatusBadge, type Tone } from "@/components/app/status-badge"
import { Button, ButtonLink } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { isRecord } from "@/lib/guards"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ApiDocument, ApiOperation, JsonSchema, JsonValue } from "./api"

const METHOD_TONE: Record<string, Tone> = { get: "info", post: "positive", patch: "warning", delete: "negative" }
const REF = "#/components/schemas/"

interface Op {
  method: string
  path: string
  op: ApiOperation
}

function operationsByTag(doc: ApiDocument): Map<string, Op[]> {
  const out = new Map<string, Op[]>(doc.tags.map((t) => [t.name, []]))
  for (const [path, methods] of Object.entries(doc.paths))
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags[0] ?? "Other"
      if (!out.has(tag)) out.set(tag, [])
      out.get(tag)?.push({ method, path, op })
    }
  return out
}

const anchor = (s: string) => `schema-${s}`

function asSchema(v: JsonValue | undefined): JsonSchema | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : undefined
}

function schemaList(v: JsonValue | undefined): JsonSchema[] {
  const out: JsonSchema[] = []
  if (Array.isArray(v))
    for (const x of v) {
      const s = asSchema(x)
      if (s) out.push(s)
    }
  return out
}

function schemaMap(v: JsonValue | undefined): [string, JsonSchema][] {
  return Object.entries(asSchema(v) ?? {}).flatMap(([k, x]) => {
    const s = asSchema(x)
    return s ? [[k, s] as const] : []
  })
}

function stringSet(v: JsonValue | undefined): Set<string> {
  return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : [])
}

/** Text with `code` spans (descriptions in the OpenAPI document use backticks). */
function Rich({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") ? (
      // parts of a fixed string: the position is the identity
      // oxlint-disable-next-line react/no-array-index-key, react-doctor/no-array-index-as-key
      <code key={i} className="rounded bg-muted px-1 font-mono text-[0.92em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  )
}

/** Short type notation of a JSON schema: `Entry`, `string (date)`, `"a" | "b"`, `Entry[] | null`. */
function TypeName({ schema }: { schema: JsonSchema }): ReactNode {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace(REF, "")
    return (
      <a href={`#${anchor(name)}`} className="text-primary underline-offset-4 hover:underline">
        {name}
      </a>
    )
  }
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(" | ")
  if (Array.isArray(schema.anyOf))
    return schemaList(schema.anyOf).map((s, i) => (
      <Fragment key={JSON.stringify(s)}>
        {i > 0 ? " | " : null}
        <TypeName schema={s} />
      </Fragment>
    ))
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const type = types.filter((x) => typeof x === "string").join(" | ") || "any"
  const items = asSchema(schema.items)
  if (schema.type === "array" && items)
    return (
      <>
        <TypeName schema={items} />
        []
      </>
    )
  const additional = asSchema(schema.additionalProperties)
  if (schema.type === "object" && additional)
    return (
      <>
        {"{ [key]: "}
        <TypeName schema={additional} />
        {" }"}
      </>
    )
  return typeof schema.format === "string" ? `${type} (${schema.format})` : type
}

function constraints(s: JsonSchema): string {
  const parts: string[] = []
  if (s.default !== undefined) parts.push(`= ${JSON.stringify(s.default)}`)
  if (typeof s.minimum === "number") parts.push(`≥ ${s.minimum}`)
  if (typeof s.exclusiveMinimum === "number" && s.exclusiveMinimum !== 0) parts.push(`> ${s.exclusiveMinimum}`)
  if (typeof s.maximum === "number") parts.push(`≤ ${s.maximum}`)
  if (typeof s.maxLength === "number") parts.push(`max ${s.maxLength}`)
  if (typeof s.maxItems === "number") parts.push(`max ${s.maxItems} items`)
  return parts.join(", ")
}

function nestedObject(p: JsonSchema): JsonSchema | null {
  if (p.type === "object" && p.properties) return p
  const items = asSchema(p.items)
  return p.type === "array" && items?.properties ? items : null
}

function PropertyRows({ schema, depth = 0 }: { schema: JsonSchema; depth?: number }) {
  const t = useT()
  const props = schemaMap(schema.properties)
  const required = stringSet(schema.required)
  if (!props.length)
    return (
      <p className="py-2 font-mono text-[13px] text-muted-foreground">
        {schema.type === "object" ? t("apidocs.free_form") : <TypeName schema={schema} />}
      </p>
    )
  return props.map(([name, p]) => {
    const nested = nestedObject(p)
    const note = [typeof p.description === "string" ? p.description : "", constraints(p)].filter(Boolean).join(" · ")
    return (
      <Fragment key={`${depth}-${name}`}>
        <div
          className="flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-0 sm:flex-row sm:gap-4"
          style={{ paddingLeft: depth * 16 }}
        >
          <div className="shrink-0 font-mono text-[13px] sm:w-44">
            {name}
            {required.has(name) ? null : <span className="text-muted-foreground">?</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] break-words text-muted-foreground">
              {nested ? p.type === "array" ? "object[]" : "object" : <TypeName schema={p} />}
            </div>
            {note ? (
              <div className="text-sm text-muted-foreground">
                <Rich text={note} />
              </div>
            ) : null}
          </div>
        </div>
        {nested ? <PropertyRows schema={nested} depth={depth + 1} /> : null}
      </Fragment>
    )
  })
}

function SchemaTable({ schema }: { schema: JsonSchema }) {
  if (typeof schema.$ref === "string")
    return (
      <p className="font-mono text-[13px]">
        <TypeName schema={schema} />
      </p>
    )
  return (
    <div className="flex flex-col">
      <PropertyRows schema={schema} />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-2 right-2 size-8"
      aria-label={t("apidocs.copy")}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  )
}

function exampleValue(schema: JsonSchema | undefined, doc: ApiDocument): unknown {
  if (!schema) return null
  if (typeof schema.$ref === "string") return exampleValue(doc.components.schemas[schema.$ref.replace(REF, "")], doc)
  if (Array.isArray(schema.examples)) return schema.examples[0]
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if (Array.isArray(schema.anyOf)) return exampleValue(schemaList(schema.anyOf)[0], doc)
  switch (Array.isArray(schema.type) ? schema.type[0] : schema.type) {
    case "object": {
      const req = stringSet(schema.required)
      return Object.fromEntries(
        schemaMap(schema.properties)
          .filter(([k]) => req.has(k))
          .map(([k, v]) => [k, exampleValue(v, doc)]),
      )
    }
    case "array":
      return []
    case "integer":
    case "number":
      return 1
    case "boolean":
      return true
    case "string":
      return schema.format === "date" ? "2026-11-05" : schema.format === "date-time" ? "2026-11-05T07:58:00Z" : "text"
    default:
      return null
  }
}

function curlFor(base: string, { method, path, op }: Op, doc: ApiDocument): string {
  const required = (op.parameters ?? []).filter((p) => p.in === "query" && p.required)
  const query = required.map((p) => `${p.name}=${encodeURIComponent(String(exampleValue(p.schema, doc)))}`).join("&")
  const url = `${base}${path.replace("{id}", "1")}${query ? `?${query}` : ""}`
  const lines = [
    `curl${method === "get" ? "" : ` -X ${method.toUpperCase()}`} "${url}"`,
    '  -H "Authorization: Bearer $RT_KEY"',
  ]
  const body = op.requestBody?.content["application/json"].schema
  if (body) {
    const example = exampleValue(body, doc)
    if (isRecord(example) && Object.keys(example).length) {
      lines.push('  -H "Content-Type: application/json"')
      lines.push(`  -d '${JSON.stringify(example)}'`)
    }
  }
  return lines.join(" \\\n")
}

function Endpoint({ op, doc, base }: { op: Op; doc: ApiDocument; base: string }) {
  const t = useT()
  const params = op.op.parameters ?? []
  const body = op.op.requestBody?.content["application/json"].schema
  const okStatus = Object.keys(op.op.responses).find((s) => s.startsWith("2")) ?? "200"
  const ok = op.op.responses[okStatus]
  const curl = curlFor(base, op, doc)
  return (
    <Collapsible className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90"
          aria-hidden
        />
        <StatusBadge tone={METHOD_TONE[op.method] ?? "neutral"} className="w-16 justify-center font-mono">
          {op.method.toUpperCase()}
        </StatusBadge>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm">{op.path}</span>
          <span className="block truncate text-sm text-muted-foreground">{op.op.summary}</span>
        </span>
        <StatusBadge
          tone={op.op["x-scope"] ? "brand" : "neutral"}
          icon={null}
          className="hidden font-mono sm:inline-flex"
        >
          <KeyRound className="size-3.5" aria-hidden />
          {op.op["x-scope"] ?? t("apidocs.any_scope")}
        </StatusBadge>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5 border-t border-border px-4 py-4">
        <p className="text-sm sm:hidden">
          <span className="text-muted-foreground">{t("apidocs.scope")}: </span>
          <span className="font-mono">{op.op["x-scope"] ?? t("apidocs.any_scope")}</span>
        </p>
        {op.op.description ? (
          <p className="max-w-prose text-sm text-muted-foreground">
            <Rich text={op.op.description} />
          </p>
        ) : null}
        {params.length ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">{t("apidocs.parameters")}</h4>
            <SchemaTable
              schema={{
                type: "object",
                properties: Object.fromEntries(
                  params.map((p) => [
                    p.name,
                    { ...p.schema, ...(p.description ? { description: p.description } : {}) },
                  ]),
                ),
                required: params.filter((p) => p.required).map((p) => p.name),
              }}
            />
          </div>
        ) : null}
        {body ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">{t("apidocs.body")}</h4>
            <SchemaTable schema={body} />
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">
            {t("apidocs.response")} <span className="font-mono font-normal text-muted-foreground">{okStatus}</span>
          </h4>
          {ok?.content ? (
            <SchemaTable schema={ok.content["application/json"].schema} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("apidocs.no_content")}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t("apidocs.example")}</h4>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-muted px-4 py-3 pr-12 font-mono text-[13px] leading-relaxed">
              {curl}
            </pre>
            <CopyButton text={curl} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ApiDocsView({ doc }: { doc: ApiDocument }) {
  const t = useT()
  const base = doc.servers[0]?.url ?? "/api/v1"
  const groups = [...operationsByTag(doc)].filter(([, ops]) => ops.length)
  const errorCodes = ["401", "403", "404", "409", "422", "429"]
  const sample = Object.values(doc.paths)[0]
  const errors = sample ? Object.values(sample)[0]?.responses : {}
  return (
    <Page>
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <CompanyLogo />
        </Link>
        <ButtonLink variant="outline" size="sm" href="/api/v1/openapi.json" download>
          <Download aria-hidden />
          {t("apidocs.openapi")}
        </ButtonLink>
      </div>
      <PageHeader title={`${doc.info.title} ${doc.info.version}`} />
      <Section title={t("apidocs.auth")}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">{t("apidocs.base_url")}</dt>
          <dd className="font-mono break-all">{base}</dd>
          <dt className="text-muted-foreground">{t("apidocs.header")}</dt>
          <dd className="font-mono">Authorization: Bearer rt_…</dd>
          <dt className="text-muted-foreground">{t("apidocs.keys")}</dt>
          <dd>
            <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
              {t("apidocs.keys_link")}
            </Link>
          </dd>
          <dt className="text-muted-foreground">{t("apidocs.errors")}</dt>
          <dd className="font-mono">{'{ "error": { "code", "message", "fields" } }'}</dd>
        </dl>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {errorCodes.map((code) => (
            <li key={code} className="flex gap-3">
              <span className="w-10 shrink-0 font-mono text-muted-foreground">{code}</span>
              <span>
                <Rich text={errors?.[code]?.description ?? ""} />
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <nav aria-label={t("apidocs.endpoints")} className="flex flex-wrap gap-2">
        {groups.map(([tag]) => (
          <ButtonLink key={tag} variant="outline" size="sm" href={`#tag-${tag}`}>
            {tag}
          </ButtonLink>
        ))}
        <ButtonLink variant="outline" size="sm" href="#schemas">
          {t("apidocs.schemas")}
        </ButtonLink>
      </nav>
      {groups.map(([tag, ops]) => (
        <Section key={tag} title={<span id={`tag-${tag}`}>{tag}</span>} className="scroll-mt-6">
          <div className="flex flex-col gap-2">
            {ops.map((op) => (
              <Endpoint key={`${op.method} ${op.path}`} op={op} doc={doc} base={base} />
            ))}
          </div>
        </Section>
      ))}
      <Section title={<span id="schemas">{t("apidocs.schemas")}</span>}>
        <div className="flex flex-col gap-3">
          {Object.entries(doc.components.schemas).map(([name, schema]) => (
            <div
              key={name}
              id={anchor(name)}
              className={cn("scroll-mt-6 rounded-xl border border-border bg-card px-4 py-3")}
            >
              <h3 className="mb-2 font-mono text-sm font-semibold">{name}</h3>
              <SchemaTable schema={schema} />
            </div>
          ))}
        </div>
      </Section>
    </Page>
  )
}
