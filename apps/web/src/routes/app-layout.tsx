import { useQueryClient } from "@tanstack/react-query"
import { NavLink, Outlet, useNavigate } from "react-router"
import {
  House,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Plug,
  Settings,
  Share2,
  Sun,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useTheme } from "@workspace/ui/components/theme-provider"
import { cn } from "@workspace/ui/lib/utils"

import { Mark } from "@/components/brand"
import { signOut, useSession } from "@/lib/auth-client"
import { useChatStore } from "@/stores/chat-store"
import { initialsOf } from "@/lib/format"

const TABS = [
  { to: "/app/home", label: "Home", icon: House },
  { to: "/app/membot", label: "MemBot", icon: MessageSquare },
  { to: "/app/graph", label: "Graph", icon: Share2 },
  { to: "/app/connections", label: "Connections", icon: Plug },
]

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

export function AppLayout() {
  return (
    <div className="bg-background flex h-svh flex-col">
      <AppNav />
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}

function AppNav() {
  return (
    <header className="border-border/70 flex h-14 shrink-0 items-center gap-4 border-b px-4 sm:px-6">
      <NavLink to="/app/home" className="flex items-center gap-2" aria-label="Home">
        <Mark className="text-primary size-5" />
      </NavLink>

      <nav className="bg-muted/60 flex items-center gap-0.5 rounded-full p-1" aria-label="Sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:ring-ring/30 outline-none focus-visible:ring-3",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  )
}

function UserMenu() {
  const { data } = useSession()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const user = data?.user
  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Account" />
        }
      >
        <Avatar className="size-7">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="text-xs">{initialsOf(user.name || user.email)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {/* Plain markup, not DropdownMenuLabel: that maps to Base UI's Menu.GroupLabel, which
            throws unless it is inside a Menu.Group. This identifies the account, not a group. */}
        <div className="flex flex-col gap-0.5 px-2 py-1.5 text-sm">
          <span className="truncate font-medium">{user.name}</span>
          <span className="text-muted-foreground truncate text-xs">{user.email}</span>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => navigate("/app/settings")}>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as typeof theme)}
        >
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Appearance
          </DropdownMenuLabel>
          {THEMES.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="size-4" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onClick={async () => {
            await signOut()
            queryClient.clear()
            useChatStore.getState().startNewConversation()
            navigate("/", { replace: true })
          }}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
