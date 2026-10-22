import { Select } from "@base-ui/react/select"
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown"
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check"
import { WORKFLOW_OPTIONS } from "../lib/workflowConfig"

export default function WorkflowSelect({ value, onValueChange, options = WORKFLOW_OPTIONS, disabled = false, ariaLabel = "Workflow", className = "", compact = false }) {
  const selected = options.find((option) => option.value === value) || options[0]
  return (
    <Select.Root value={selected?.value || null} onValueChange={(next) => next && onValueChange?.(next)} disabled={disabled} items={options}>
      <Select.Trigger data-workflow-tone={selected?.tone || "neutral"} aria-label={ariaLabel} className={`workflow-tone workflow-trigger ui-field inline-flex min-h-0 items-center justify-between gap-2 text-left font-medium disabled:opacity-60 ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-sm"} ${className}`}>
        <Select.Value>
          {(selectedValue) => {
            const option = options.find((item) => item.value === selectedValue) || selected
            const Icon = option?.Icon
            return <span className="flex min-w-0 items-center gap-1.5">{Icon && <Icon aria-hidden="true" className="shrink-0" size={compact ? 14 : 16} />}<span className="truncate">{option?.label}</span></span>
          }}
        </Select.Value>
        <Select.Icon><CaretDownIcon aria-hidden="true" size={13} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="z-[var(--z-popover)] outline-none" sideOffset={4} align="start">
          <Select.Popup className="ui-popover ui-popover-enter min-w-[var(--anchor-width)] overflow-hidden p-1 outline-none">
            <Select.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto py-0.5">
              {options.map((option) => {
                const Icon = option.Icon
                return <Select.Item key={option.value} value={option.value} data-workflow-tone={option.tone || "neutral"} className="workflow-tone workflow-option grid cursor-default grid-cols-[1rem_1fr_1rem] items-center gap-2 rounded-md px-2 py-2 text-xs outline-none">
                  <Icon aria-hidden="true" size={15} />
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator><CheckIcon aria-hidden="true" size={14} weight="bold" /></Select.ItemIndicator>
                </Select.Item>
              })}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
