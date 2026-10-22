export default function TaskIdentity({ brand, task, detail, className = '' }) {
  return <span className={`block min-w-0 text-left ${className}`}>
    <strong className="block truncate text-sm font-extrabold text-purple-900">{brand || 'ไม่ทราบแบรนด์'}</strong>
    <span className="mt-0.5 block truncate text-xs font-medium text-gray-600">{task || 'ไม่ทราบชื่องาน'}</span>
    {detail && <span className="mt-0.5 block truncate text-[10px] text-gray-400">{detail}</span>}
  </span>
}
