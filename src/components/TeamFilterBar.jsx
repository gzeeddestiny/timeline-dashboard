import { ROLE_CONFIG, ROLES } from "../lib/teamConfig"

/**
 * Compact horizontal filter chips for team members.
 * Shows avatar-only by default, name appears when active.
 */
export default function TeamFilterBar({ activeMember, onSelect, members = [] }) {
  const activeRoles = ROLES.filter((r) => members.some((m) => m.role === r))

  return (
    <div className="flex items-center gap-1.5 sm:gap-1 flex-nowrap whitespace-nowrap">
      {/* "All" chip */}
      <button
        onClick={() => onSelect(null)}
        className={`rounded-full px-3 sm:px-2.5 py-1.5 sm:py-1 text-xs sm:text-[10px] font-bold transition-colors duration-150 shrink-0 ${
          !activeMember
            ? "bg-[var(--ui-brand)] text-white"
            : "bg-[var(--ui-surface-subtle)] text-[var(--ui-muted)] hover:bg-[var(--ui-brand-soft)] hover:text-[var(--ui-brand)]"
        }`}
      >
        All
      </button>

      <div className="h-5 sm:h-4 w-px bg-[var(--ui-border)] mx-0.5 shrink-0" />

      {activeRoles.map((role, ri) => {
        const rc = ROLE_CONFIG[role]
        const roleMembers = members.filter((m) => m.role === role)

        return (
          <div key={role} className="flex items-center gap-1 sm:gap-0.5 shrink-0">
            {roleMembers.map((m) => {
              const isActive = activeMember === m.name
              const initial = m.name[0]?.toUpperCase() || "?"

              return (
                <button
                  key={m.name}
                  onClick={() => onSelect(isActive ? null : m.name)}
                  title={`${m.name} (${rc.label})`}
                  className={`flex items-center gap-1 rounded-full p-0.5 transition-colors duration-150 shrink-0 ${
                    isActive
                      ? `${rc.bg} ring-1 ${rc.ring} pr-2`
                      : "hover:bg-gray-50 active:bg-gray-100"
                  }`}
                >
                  {m.avatar ? (
                    <img
                      src={m.avatar}
                      alt={m.name}
                      className={`h-8 w-8 sm:h-6 sm:w-6 rounded-full object-cover ring-1 ${isActive ? rc.ring : "ring-gray-200"}`}
                    />
                  ) : (
                    <span
                      className={`flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded-full text-xs sm:text-[10px] font-bold ring-1 ${
                        isActive ? `${rc.bg} ${rc.ring} text-gray-700` : "bg-gray-100 text-gray-500 ring-gray-200"
                      }`}
                    >
                      {initial}
                    </span>
                  )}
                  {isActive && (
                    <span className="text-xs sm:text-[10px] font-semibold text-gray-700">
                      {m.name}
                    </span>
                  )}
                </button>
              )
            })}

            {ri < activeRoles.length - 1 && <div className="h-5 sm:h-4 w-px bg-[var(--ui-border)] mx-0.5" />}
          </div>
        )
      })}
    </div>
  )
}
