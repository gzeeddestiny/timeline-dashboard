import { Menu } from "@base-ui/react/menu"
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell"
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank"
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsThreeVertical"
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix"
import { KanbanIcon } from "@phosphor-icons/react/dist/csr/Kanban"
import { ListBulletsIcon } from "@phosphor-icons/react/dist/csr/ListBullets"
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus"
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour"
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise"
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings"
import { ClockCountdownIcon } from "@phosphor-icons/react/dist/csr/ClockCountdown"
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt"
import magicLogo from "../assets/magic-logo.svg"
import { formatThaiDate } from "../lib/dates"
import NotificationCenter from "./NotificationCenter"
import TeamFilterBar from "../components/TeamFilterBar"

const VIEWS = [
  { mode: "my", label: "My Work", Icon: KanbanIcon },
  { mode: "table", label: "Explorer", Icon: ListBulletsIcon },
  { mode: "brand", label: "Brand", Icon: BuildingsIcon },
  { mode: "dashboard", label: "Timeline", Icon: SquaresFourIcon },
  { mode: "follow_up", label: "Follow-up", Icon: ClockCountdownIcon, adminOnly: true },
]

function UtilityItem({ Icon, children, onClick }) {
  return <Menu.Item className="app-menu-item" onClick={onClick}><Icon aria-hidden="true" size={18} /><span>{children}</span></Menu.Item>
}

export default function AppHeader({ viewMode, onViewChange, filterMember, onFilterMemberChange, teamMembers, isAdmin, role, configured, email, isRefreshing, lastRefreshedAt, onRefresh, onOpenTask, onOpenContract, onOpenTeam, onOpenAdmin, onOpenManual, onSignOut }) {
  return (
    <header className="ui-header sticky top-0 z-[var(--z-sticky)]">
      <div className="ui-header-inner mx-auto flex h-16 max-w-screen-2xl items-center gap-3 px-3 sm:px-6">
        <a href="#main-content" className="ui-brand-home flex shrink-0 items-center gap-2" aria-label="MAGIC Timeline หน้าแรก">
          <img src={magicLogo} alt="" className="h-9 w-9 object-contain" />
          <span className="hidden leading-none sm:block"><strong className="block text-sm font-extrabold tracking-[-0.02em] text-[var(--ui-brand)]">MAGIC</strong><span className="text-[11px] font-medium text-[var(--ui-muted)]">Timeline</span></span>
        </a>
        <nav className="ui-nav-tabs ui-nav-scroll scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex-initial" aria-label="มุมมองหลัก">
          {VIEWS.filter((view) => !view.adminOnly || isAdmin).map(({ mode, label, Icon }) => (
            <button key={mode} type="button" className="ui-nav-tab" data-active={viewMode === mode} aria-current={viewMode === mode ? "page" : undefined} onClick={() => onViewChange(mode)}>
              <Icon aria-hidden="true" size={17} weight={viewMode === mode ? "fill" : "regular"} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="hidden items-center gap-1.5 text-xs font-medium text-[var(--ui-muted)] lg:flex"><CalendarBlankIcon aria-hidden="true" size={16} />{formatThaiDate(new Date(), { weekday: "short" })}</span>
          <button type="button" onClick={onRefresh} disabled={isRefreshing} className="ui-button ui-button-secondary min-h-0 px-2 py-1.5 text-xs disabled:opacity-50" title={lastRefreshedAt ? `ข้อมูลหน้าจอล่าสุด ${lastRefreshedAt.toLocaleTimeString("th-TH")}` : "Refresh ข้อมูลหน้าจอ"}>
            <ArrowClockwiseIcon aria-hidden="true" className={isRefreshing ? "animate-spin" : ""} size={16} />
            <span className="hidden sm:inline">{isRefreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
          {lastRefreshedAt && <span className="hidden text-[10px] text-[var(--ui-muted)] xl:block">อัปเดต {lastRefreshedAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>}
          <NotificationCenter configured={configured} email={email} onOpenTask={onOpenTask} onOpenContract={onOpenContract} onOpenAttention={(type) => onViewChange(type === "delivery_failure" ? "follow_up" : "my")} triggerIcon={BellIcon} />
          <Menu.Root>
            <Menu.Trigger className="ui-icon-button" aria-label="เปิดเมนูเครื่องมือ"><DotsThreeVerticalIcon aria-hidden="true" size={20} weight="bold" /></Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="z-[var(--z-popover)]" sideOffset={8} align="end">
                <Menu.Popup className="ui-popover ui-popover-enter min-w-56 p-1.5">
                  <div className="px-2.5 py-2"><p className="truncate text-xs font-semibold text-[var(--ui-text)]">{email || "Local workspace"}</p><p className="mt-0.5 text-[11px] capitalize text-[var(--ui-muted)]">{role || "member"}</p></div>
                  <Menu.Separator className="my-1 h-px bg-[var(--ui-border)]" />
                  {isAdmin && <UtilityItem Icon={UsersThreeIcon} onClick={onOpenTeam}>จัดการทีม</UtilityItem>}
                  {isAdmin && <UtilityItem Icon={PaperPlaneTiltIcon} onClick={onOpenManual}>Send notification</UtilityItem>}
                  <UtilityItem Icon={isAdmin ? GearSixIcon : PlusIcon} onClick={onOpenAdmin}>{isAdmin ? "Admin settings" : "Add Sheet"}</UtilityItem>
                  {configured && <><Menu.Separator className="my-1 h-px bg-[var(--ui-border)]" /><UtilityItem Icon={SignOutIcon} onClick={onSignOut}>Sign out</UtilityItem></>}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      {viewMode === "table" && <div className="border-t border-[var(--ui-border)] px-3 py-2 sm:px-6"><div className="scrollbar-hide mx-auto max-w-screen-2xl overflow-x-auto"><TeamFilterBar activeMember={filterMember} onSelect={onFilterMemberChange} members={teamMembers} /></div></div>}
    </header>
  )
}
