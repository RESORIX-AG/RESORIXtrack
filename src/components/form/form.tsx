/**
 * Forms: TanStack Form + zod + shadcn Field. One way to build every form.
 *
 *   const form = useAppForm({
 *     defaultValues: { name: "", minutes: 0 },
 *     validators: { onChange: schema },          // zod schema of the whole form
 *     onSubmit: async ({ value }) => { await save({ data: value }) },
 *   })
 *   <form.AppForm>
 *     <FormRoot form={form}>
 *       <form.AppField name="name" children={(f) => <f.TextField label={t("common.name")} />} />
 *       <form.SubmitButton>{t("common.save")}</form.SubmitButton>
 *     </FormRoot>
 *   </form.AppForm>
 *
 * Validation timing (docs/design.md): errors appear when a field is left (blur) and then update live
 * while it is corrected; on submit, all errors show and focus moves to the first invalid field. The
 * submit button stays enabled (it explains on click instead of silently refusing).
 * Server errors (AppError.fields) are mapped onto fields with `applyServerErrors`.
 */
import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form"
import { type ComponentProps, type ReactNode, useId } from "react"
import { Segmented, type SegmentedOption } from "@/components/app/segmented"
import { SaveBar as SaveBarFrame, SettingRow, SettingsFooter } from "@/components/app/settings"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { DatePicker, type DayMarks } from "@/components/ui/date-picker"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/guards"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts()

/**
 * Field errors are either messages or codes. A code without spaces is translated: `ns.key` as is, a bare code
 * via `errors.fields.<code>` (server field errors, zod refine messages); unknown codes fall back to the text.
 */
export function messageOf(err: unknown, tr: (k: string) => string): string {
  const raw = typeof err === "string" ? err : (errorMessage(err) ?? "")
  if (!raw || /\s/.test(raw)) return raw
  const key = raw.includes(".") && !raw.startsWith("fields.") ? raw : `errors.fields.${raw.replace(/^fields\./, "")}`
  const text = tr(key)
  return text === key ? raw : text
}

/** Shared label/description/error frame for a field. */
function useFieldFrame<T = unknown>() {
  const field = useFieldContext<T>()
  const { t } = useI18n()
  const submitted = useStore(field.form.store, (s) => s.submissionAttempts > 0)
  const show = (field.state.meta.isBlurred || submitted) && field.state.meta.errors.length > 0
  const error = show ? messageOf(field.state.meta.errors[0], t) : ""
  // unique per form instance: two forms with the same field names on one page never share an id
  return { field, error, id: `${useId()}${field.name}` }
}

interface BaseProps {
  label: ReactNode
  description?: ReactNode
  /** visually hide the label (still announced) */
  srLabel?: boolean
  /** settings layout: label and hint left, control right (SettingRow) */
  row?: boolean
  /** width of the control in a row (default `md:w-72`) */
  controlClassName?: string
}

function Frame({
  id,
  label,
  description,
  error,
  srLabel,
  row,
  controlClassName,
  children,
}: BaseProps & { id: string; error: string; children: ReactNode }) {
  if (row)
    return (
      <SettingRow
        label={label}
        hint={description}
        htmlFor={id}
        error={error ? <span id={`${id}-err`}>{error}</span> : undefined}
        control={<div className={cn("w-full md:w-72", controlClassName)}>{children}</div>}
      />
    )
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} className={srLabel ? "sr-only" : undefined}>
        {label}
      </FieldLabel>
      {children}
      {/* reserve no layout jump: description and error share the slot below the control */}
      {error ? (
        <FieldError id={`${id}-err`}>{error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

export function TextField({
  label,
  description,
  srLabel,
  row,
  controlClassName,
  ...input
}: BaseProps & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "id" | "name">) {
  const { field, error, id } = useFieldFrame<string | number | null | undefined>()
  return (
    <Frame
      id={id}
      label={label}
      description={description}
      error={error}
      srLabel={srLabel}
      row={row}
      controlClassName={controlClassName}
    >
      <Input
        id={id}
        name={field.name}
        data-field={field.name}
        value={field.state.value ?? ""}
        onChange={(e) =>
          field.handleChange(
            input.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value,
          )
        }
        onBlur={field.handleBlur}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...input}
      />
    </Frame>
  )
}

/**
 * Free text: grows with its content from two lines up to a maximum height, then scrolls. A quiet counter
 * appears once the text is within 20 % of `maxLength` (pass the server limit).
 */
export function TextareaField({
  label,
  description,
  srLabel,
  row,
  controlClassName,
  maxLength,
  className,
  ...rest
}: BaseProps & Omit<ComponentProps<typeof Textarea>, "value" | "onChange" | "onBlur" | "id" | "name">) {
  const { field, error, id } = useFieldFrame<string | null | undefined>()
  const length = (field.state.value ?? "").length
  const counter = maxLength && length >= maxLength * 0.8 ? `${length} / ${maxLength}` : null
  const full = maxLength != null && length >= maxLength
  return (
    <Frame
      id={id}
      label={label}
      description={description}
      error={error}
      srLabel={srLabel}
      row={row}
      controlClassName={controlClassName}
    >
      <div className="relative">
        <Textarea
          id={id}
          name={field.name}
          data-field={field.name}
          value={field.state.value ?? ""}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={field.handleBlur}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={cn(counter && "pb-6", className)}
          {...rest}
        />
        {counter ? (
          <span
            className={cn(
              "pointer-events-none absolute right-2.5 bottom-1.5 text-xs tabular",
              full ? "text-destructive" : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {counter}
          </span>
        ) : null}
      </div>
    </Frame>
  )
}

export function SelectField({
  label,
  description,
  srLabel,
  row,
  controlClassName,
  options,
  placeholder,
  disabled,
}: BaseProps & {
  /** `short` is shown in the closed trigger when the full label is long */
  options: { value: string; label: ReactNode; short?: ReactNode }[]
  placeholder?: string
  disabled?: boolean
}) {
  const { field, error, id } = useFieldFrame()
  return (
    <Frame
      id={id}
      label={label}
      description={description}
      error={error}
      srLabel={srLabel}
      row={row}
      controlClassName={controlClassName}
    >
      <Select
        items={options.map((o) => ({ value: o.value, label: o.short ?? o.label }))}
        value={
          typeof field.state.value === "string" || typeof field.state.value === "number"
            ? String(field.state.value)
            : null
        }
        onValueChange={(v) => {
          field.handleChange(v ?? "")
          field.handleBlur()
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} data-field={field.name} aria-invalid={error ? true : undefined} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Frame>
  )
}

/** A form-submitted on/off (checkbox semantics). For immediate settings use a plain Switch outside forms. */
export function SwitchField({
  label,
  description,
  row,
  disabled,
}: Omit<BaseProps, "srLabel" | "controlClassName"> & { disabled?: boolean }) {
  const { field, id } = useFieldFrame()
  const control = (
    <Switch
      id={id}
      data-field={field.name}
      disabled={disabled}
      checked={Boolean(field.state.value)}
      onCheckedChange={(v) => field.handleChange(v)}
    />
  )
  if (row) return <SettingRow label={label} hint={description} htmlFor={id} inline control={control} />
  return (
    <Field orientation="horizontal">
      {control}
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </div>
    </Field>
  )
}

/** A date (`YYYY-MM-DD`, "" when empty) with the calendar popover; validates on close like a blur. */
export function DateField({
  label,
  description,
  srLabel,
  row,
  controlClassName,
  min,
  max,
  far,
  marks,
  placeholder,
  disabled,
}: BaseProps & {
  min?: string
  max?: string
  far?: boolean
  marks?: DayMarks
  placeholder?: string
  disabled?: boolean
}) {
  const { field, error, id } = useFieldFrame<string | null | undefined>()
  return (
    <Frame
      id={id}
      label={label}
      description={description}
      error={error}
      srLabel={srLabel}
      row={row}
      controlClassName={controlClassName}
    >
      <DatePicker
        id={id}
        name={field.name}
        value={field.state.value ?? ""}
        onChange={(v) => field.handleChange(v)}
        onBlur={field.handleBlur}
        min={min}
        max={max}
        far={far}
        marks={marks}
        placeholder={placeholder}
        disabled={disabled}
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
      />
    </Frame>
  )
}

/** A searchable single choice (long or dynamic lists: timezones, teams, people). */
export function ComboboxField({
  label,
  description,
  srLabel,
  row,
  controlClassName,
  options,
  placeholder,
  allowClear,
}: BaseProps & { options: ComboboxOption[]; placeholder?: string; allowClear?: string }) {
  const { field, error, id } = useFieldFrame<string | null | undefined>()
  return (
    <Frame
      id={id}
      label={label}
      description={description}
      error={error}
      srLabel={srLabel}
      row={row}
      controlClassName={controlClassName}
    >
      <Combobox
        id={id}
        value={field.state.value ?? null}
        onChange={(v) => {
          field.handleChange(v ?? "")
          field.handleBlur()
        }}
        options={options}
        placeholder={placeholder}
        allowClear={allowClear}
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
      />
    </Frame>
  )
}

/** A single choice among 2 to 5 options as a segmented control. */
export function SegmentedField<const T extends string>({
  label,
  description,
  srLabel,
  row,
  controlClassName,
  options,
  fill,
}: BaseProps & { options: readonly SegmentedOption<T>[]; fill?: boolean }) {
  const { field, error, id } = useFieldFrame<T>()
  const labelId = `${id}-label`
  const control = (
    <Segmented
      id={id}
      value={field.state.value}
      onValueChange={(v) => {
        field.handleChange(v)
        field.handleBlur()
      }}
      options={options}
      fill={fill ?? !row}
      aria-labelledby={labelId}
    />
  )
  if (row)
    return (
      <SettingRow
        label={label}
        hint={description}
        labelId={labelId}
        error={error || undefined}
        control={<div className={cn("w-full md:w-auto", controlClassName)}>{control}</div>}
      />
    )
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel id={labelId} className={srLabel ? "sr-only" : undefined}>
        {label}
      </FieldLabel>
      {control}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

export function SubmitButton({ children, ...props }: Omit<ComponentProps<typeof Button>, "type">) {
  const form = useFormContext()
  const submitting = useStore(form.store, (s) => s.isSubmitting)
  return (
    <Button type="submit" disabled={submitting} {...props}>
      {submitting ? <Spinner data-icon="inline-start" /> : null}
      {children}
    </Button>
  )
}

/**
 * Save (and Discard while there are unsaved changes) for a settings form. `page`: spans the page and sticks to
 * the bottom while there are unsaved changes; `group`: the last row of a settings group.
 */
export function SaveBar({ placement = "page" }: { placement?: "page" | "group" }) {
  const form = useFormContext()
  const { t } = useI18n()
  const dirty = useStore(form.store, (s) => !s.isDefaultValue)
  if (placement === "group")
    return (
      <SettingsFooter note={dirty ? t("admin.settings.unsaved") : undefined}>
        <SubmitButton variant={dirty ? "default" : "outline"}>{t("common.save")}</SubmitButton>
      </SettingsFooter>
    )
  return (
    <SaveBarFrame dirty={dirty} label={t("admin.settings.unsaved")}>
      {dirty ? (
        <Button type="button" variant="ghost" onClick={() => form.reset()}>
          {t("common.discard")}
        </Button>
      ) : null}
      <SubmitButton>{t("common.save")}</SubmitButton>
    </SaveBarFrame>
  )
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    SelectField,
    SwitchField,
    DateField,
    SegmentedField,
    ComboboxField,
  },
  formComponents: { SubmitButton, SaveBar },
})

/**
 * <form> element that submits the TanStack form and moves focus to the first invalid field.
 */
export function FormRoot({
  form,
  children,
  className,
  id,
}: {
  form: { handleSubmit: () => Promise<void> }
  children: ReactNode
  className?: string
  /** lets a submit button outside the form (a dialog footer) target it */
  id?: string
}) {
  return (
    <form
      id={id}
      // a submit before hydration must never put field values (passwords) into a URL
      method="post"
      noValidate
      className={className ?? "flex flex-col gap-5"}
      onSubmit={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const el = e.currentTarget
        await form.handleSubmit()
        el.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()
      }}
    >
      {children}
    </form>
  )
}
