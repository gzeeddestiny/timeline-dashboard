import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise"
import { BriefcaseIcon } from "@phosphor-icons/react/dist/csr/Briefcase"
import { CalendarIcon } from "@phosphor-icons/react/dist/csr/Calendar"
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock"
import { FireIcon } from "@phosphor-icons/react/dist/csr/Fire"
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk"
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder"
import { GearIcon } from "@phosphor-icons/react/dist/csr/Gear"
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass"
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold"
import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil"
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus"
import { PauseCircleIcon } from "@phosphor-icons/react/dist/csr/PauseCircle"
import { PlayCircleIcon } from "@phosphor-icons/react/dist/csr/PlayCircle"
import { CircleDashedIcon } from "@phosphor-icons/react/dist/csr/CircleDashed"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour"
import { TrayIcon } from "@phosphor-icons/react/dist/csr/Tray"
import { TrendUpIcon } from "@phosphor-icons/react/dist/csr/TrendUp"
import { UserGearIcon } from "@phosphor-icons/react/dist/csr/UserGear"
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"

const ICONS = {
  notStarted: CircleDashedIcon,
  inProgress: PlayCircleIcon,
  waitingClient: HourglassIcon,
  blocked: PauseCircleIcon,
  done: CheckCircleIcon,
  overdue: WarningIcon,
  dueToday: ClockIcon,
  next7: CalendarIcon,
  later: CalendarIcon,
  unscheduled: FolderIcon,
  urgent: FireIcon,
  high: LightningIcon,
  dataHealth: ChartBarIcon,
  aging: ClockIcon,
  trend: TrendUpIcon,
  activity: ClockIcon,
  roadmap: MapTrifoldIcon,
  clientHealth: BriefcaseIcon,
  team: UsersIcon,
  upcoming: CalendarIcon,
  sync: ArrowClockwiseIcon,
  save: FloppyDiskIcon,
  retry: ArrowClockwiseIcon,
  add: PlusIcon,
  assign: UsersIcon,
  remark: NotePencilIcon,
  admin: UserGearIcon,
  celebration: CheckCircleIcon,
  inbox: TrayIcon,
  search: MagnifyingGlassIcon,
  warning: WarningIcon,
  settings: GearIcon,
}

export default function Emoji({ name, size = 15, weight = "regular", className = "" }) {
  const Icon = ICONS[name] || SquaresFourIcon
  return <Icon aria-hidden="true" className={`ui-inline-icon ${className}`} size={size} weight={weight} />
}
