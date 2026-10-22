import { CalendarIcon } from "@phosphor-icons/react/dist/csr/Calendar"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { CircleDashedIcon } from "@phosphor-icons/react/dist/csr/CircleDashed"
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder"
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass"
import { PauseCircleIcon } from "@phosphor-icons/react/dist/csr/PauseCircle"
import { PlayCircleIcon } from "@phosphor-icons/react/dist/csr/PlayCircle"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"

export const WORKFLOW_OPTIONS = [
  { value: "not_started", label: "Not started", Icon: CircleDashedIcon, tone: "neutral" },
  { value: "in_progress", label: "In progress", Icon: PlayCircleIcon, tone: "progress" },
  { value: "waiting_client", label: "Waiting client", Icon: HourglassIcon, tone: "waiting" },
  { value: "blocked", label: "Hold", Icon: PauseCircleIcon, tone: "hold" },
]

export const WORKFLOW_FILTER_OPTIONS = [
  { value: "all", label: "All workflow", Icon: SquaresFourIcon, tone: "brand" },
  ...WORKFLOW_OPTIONS,
]

export const DASHBOARD_STATUS_OPTIONS = [
  { value: "all", label: "All", Icon: SquaresFourIcon, tone: "brand" },
  { value: "overdue", label: "Overdue", Icon: WarningIcon, tone: "overdue" },
  { value: "upcoming", label: "Upcoming", Icon: CalendarIcon, tone: "upcoming" },
  { value: "done", label: "Done", Icon: CheckCircleIcon, tone: "done" },
  ...WORKFLOW_OPTIONS,
  { value: "unscheduled", label: "Unscheduled", Icon: FolderIcon, tone: "unscheduled" },
]

export const STATUS_BY_VALUE = Object.fromEntries(DASHBOARD_STATUS_OPTIONS.map((option) => [option.value, option]))
export const WORKFLOW_BY_VALUE = Object.fromEntries(WORKFLOW_OPTIONS.map((option) => [option.value, option]))

export function workflowLabel(value) {
  return STATUS_BY_VALUE[value]?.label || value?.replaceAll("_", " ") || "Not started"
}

export function workflowTone(value) {
  return STATUS_BY_VALUE[value]?.tone || "neutral"
}
