import { XIcon } from "@phosphor-icons/react/dist/csr/X"
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap"

export function Button({ variant = "secondary", size = "md", className = "", type = "button", children, loading = false, leadingIcon, trailingIcon, disabled, ...props }) {
  return (
    <button
      type={type}
      className={`ui-button ui-button-${variant} ui-button-${size} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {loading ? <SpinnerGapIcon className="ui-button-spinner" aria-hidden="true" size={17} weight="bold" /> : leadingIcon ? <span className="ui-button-icon" aria-hidden="true">{leadingIcon}</span> : null}
      <span className="ui-button-label">{children}</span>
      {!loading && trailingIcon ? <span className="ui-button-icon" aria-hidden="true">{trailingIcon}</span> : null}
    </button>
  )
}

export function IconButton({ label, className = "", children, ...props }) {
  return <Button aria-label={label} title={label} className={`ui-icon-button ${className}`} {...props}>{children}</Button>
}

export function Card({ as: Component = "section", className = "", children, ...props }) {
  return <Component className={`ui-card ${className}`} {...props}>{children}</Component>
}

export function Badge({ tone = "neutral", className = "", children, ...props }) {
  return <span className={`ui-badge ui-badge-${tone} ${className}`} {...props}>{children}</span>
}

export function Banner({ tone = "info", className = "", icon, children, actions }) {
  return (
    <div className={`ui-banner ui-banner-${tone} ${className}`} role={tone === "danger" ? "alert" : "status"}>
      {icon && <span className="ui-banner-icon" aria-hidden="true">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="ui-banner-actions">{actions}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className = "" }) {
  return (
    <div className={`ui-empty ${className}`} role="status">
      {icon && <span className="ui-empty-icon" aria-hidden="true">{icon}</span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

export function SectionHeader({ icon, title, meta, action, className = "", titleAs: Title = "h2" }) {
  return (
    <div className={`ui-section-header ${className}`}>
      <div className="ui-section-heading">
        {icon && <span className="ui-section-icon" aria-hidden="true">{icon}</span>}
        <Title>{title}</Title>
        {meta && <span className="ui-section-meta">{meta}</span>}
      </div>
      {action}
    </div>
  )
}

export function CloseButton({ label = "ปิด", ...props }) {
  return <IconButton label={label} {...props}><XIcon size={18} weight="bold" /></IconButton>
}

export function Skeleton({ className = "", ...props }) {
  return <span className={`ui-skeleton ${className}`} aria-hidden="true" {...props} />
}

export function ViewSkeleton({ label = "กำลังโหลดข้อมูล" }) {
  return (
    <div className="ui-card ui-view-skeleton" role="status" aria-label={label}>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-52 max-w-[60vw]" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-20 w-full" />)}
      </div>
      <Skeleton className="mt-5 h-52 w-full" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
