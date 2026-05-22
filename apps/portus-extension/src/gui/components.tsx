import * as React from "react";
import { Alert } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field.js";
import { Separator } from "../components/ui/separator.js";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip.js";
import { cn } from "../lib/utils.js";
import { badgeToneForState } from "./status.js";

export function StatusBadge({ label, state }: { label: string; state: string }): React.JSX.Element {
  const tooltipContent = React.useMemo(() => {
    switch (state) {
      case "connected":
        return "Connected to bridge";
      case "connecting":
        return "Connecting to bridge...";
      case "error":
        return "Connection failed";
      default:
        return "Disconnected from bridge";
    }
  }, [state]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={badgeToneForState(state)}>
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </Tooltip>
  );
}

export function StatusGrid({ rows }: { rows: Array<{ label: string; value: string }> }): React.JSX.Element {
  return (
    <dl className="grid gap-[var(--portus-subsection-gap)]">
      {rows.map((row) => (
        <div className="flex items-baseline justify-between gap-[var(--portus-section-gap)]" key={row.label}>
          <dt className="text-xs font-semibold text-muted-foreground">{row.label}</dt>
          <dd className="max-w-48 break-words text-right text-xs text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({
  title,
  action,
  children,
  className,
  showDivider = true
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  showDivider?: boolean;
}): React.JSX.Element {
  return (
    <section className={cn("grid gap-[var(--portus-section-gap)]", className)} aria-labelledby={idForTitle(title)}>
      {showDivider ? <Separator /> : null}

      <div className="flex items-center justify-between gap-[var(--portus-section-gap)]">
        <h2 id={idForTitle(title)} className="text-sm font-bold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Diagnostics({ message, error }: { message: string; error: boolean }): React.JSX.Element {
  if (!message) return <p className="text-xs text-muted-foreground" role="status" />;
  if (error) {
    return (
      <Alert className="px-0 py-0 text-xs" role="status" variant="destructive">
        {message}
      </Alert>
    );
  }
  return (
    <p className="text-xs leading-5 text-muted-foreground" role="status">
      {message}
    </p>
  );
}

export function SelectField({
  id,
  label,
  value,
  disabled,
  options,
  onChange,
  placeholder = "Select",
  "aria-label": ariaLabel
}: {
  id?: string;
  label?: string;
  value: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange(value: string): void;
  placeholder?: string;
  "aria-label"?: string;
}): React.JSX.Element {
  const control = (
    <Select {...(disabled === undefined ? {} : { disabled })} onValueChange={onChange} value={value}>
      <SelectTrigger
        aria-label={ariaLabel}
        id={id}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem {...(option.disabled === undefined ? {} : { disabled: option.disabled })} key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
  if (!label) return control;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {control}
    </Field>
  );
}

export function NativeRadioGroupField({
  label,
  value,
  disabled,
  options,
  onChange,
  description,
  columns = 1
}: {
  label: string;
  name: string;
  value: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
  description?: string;
  columns?: 1 | 2;
}): React.JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <div className={cn("grid overflow-hidden rounded-[var(--radius-md)] border", columns === 2 ? "grid-cols-2" : "")} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            aria-checked={value === option.value}
            className={cn(
              "min-h-[var(--portus-control-height)] px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              value === option.value ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

function idForTitle(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-title`;
}
