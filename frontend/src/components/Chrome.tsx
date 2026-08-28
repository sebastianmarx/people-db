import { NavLink, Outlet } from 'react-router-dom'

/** App shell: content area plus the two-item bottom tab bar. */
export default function Chrome() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
      isActive ? 'text-sky-400' : 'text-slate-400'
    }`

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <nav className="safe-bottom flex border-t border-slate-800 bg-slate-900/95 backdrop-blur">
        <NavLink to="/" className={tab} end>
          <span aria-hidden className="text-lg">
            👥
          </span>
          People
        </NavLink>
        <NavLink to="/chat" className={tab}>
          <span aria-hidden className="text-lg">
            💬
          </span>
          Chat
        </NavLink>
      </nav>
    </div>
  )
}
