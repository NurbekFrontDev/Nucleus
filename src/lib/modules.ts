// Nucleus modules: the app is a shell that hosts modules.
// Module 1 - FinLit (finance, lives at the root). Module 2 - Planner (lives under /planner).
// The active module is derived from the current route, so no extra storage is needed.

export type NavItem = { to: string; key: string; icon: string; end?: boolean; adminOnly?: boolean }

export type ModuleId = 'finlit' | 'planner' | 'admin'

export type ModuleDef = {
  id: ModuleId
  nameKey: string
  icon: string
  home: string
  adminOnly?: boolean
  nav: NavItem[]
}

export const MODULES: ModuleDef[] = [
  {
    id: 'finlit',
    nameKey: 'mod.finlit',
    icon: '💰',
    home: '/',
    nav: [
      { to: '/', key: 'nav.dashboard', icon: '🏠', end: true },
      { to: '/incomes', key: 'nav.incomes', icon: '💼' },
      { to: '/expenses', key: 'nav.expenses', icon: '🧾' },
      { to: '/budget', key: 'nav.budget', icon: '📊' },
      { to: '/goals', key: 'nav.goals', icon: '🎯' },
      { to: '/investments', key: 'nav.investments', icon: '📈' },
      { to: '/history', key: 'nav.history', icon: '🗓️' },
      { to: '/settings', key: 'nav.settings', icon: '⚙️' },
    ],
  },
  {
    id: 'planner',
    nameKey: 'mod.planner',
    icon: '✅',
    home: '/planner',
    nav: [
      { to: '/planner', key: 'pnav.today', icon: '📅', end: true },
      { to: '/planner/items', key: 'pnav.items', icon: '🗂️' },
      { to: '/planner/matrix', key: 'pnav.matrix', icon: '⚖️' },
      { to: '/planner/water', key: 'pnav.water', icon: '💧' },
      { to: '/planner/focus', key: 'pnav.focus', icon: '🍅' },
      { to: '/planner/stats', key: 'pnav.stats', icon: '📊' },
      { to: '/planner/settings', key: 'pnav.settings', icon: '⚙️' },
    ],
  },
  {
    id: 'admin',
    nameKey: 'pnav.admin',
    icon: '🛡️',
    home: '/admin',
    adminOnly: true,
    nav: [
      { to: '/admin', key: 'admin.title', icon: '💻', end: true },
    ],
  },
]

export function moduleForPath(pathname: string): ModuleDef {
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/planner/admin') return MODULES[2]
  if (pathname === '/planner' || pathname.startsWith('/planner/')) return MODULES[1]
  return MODULES[0]
}
