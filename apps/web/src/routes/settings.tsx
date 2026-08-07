import { Monitor, Moon, Sun } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useTheme } from "@workspace/ui/components/theme-provider"
import { cn } from "@workspace/ui/lib/utils"

import { MemoryManager } from "@/components/memory/memory-manager"
import { DataSection } from "@/components/settings/data-section"
import { ProfileSection } from "@/components/settings/profile-section"

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your account, everything MemBot remembers, and how it all looks.
        </p>

        <Tabs defaultValue="profile" className="mt-8">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="pt-6">
            <ProfileSection />
          </TabsContent>

          <TabsContent value="memory" className="pt-6">
            <MemoryManager />
          </TabsContent>

          <TabsContent value="data" className="pt-6">
            <DataSection />
          </TabsContent>

          <TabsContent value="appearance" className="pt-6">
            <AppearanceSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()

  return (
    <section className="border-border bg-card/40 rounded-2xl border p-6">
      <h2 className="text-sm font-semibold">Theme</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Press <kbd className="bg-muted rounded px-1 py-0.5 font-mono text-xs">d</kbd> anywhere to
        toggle.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {THEMES.map((option) => (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            aria-pressed={theme === option.value}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm transition-colors",
              "focus-visible:ring-ring/30 outline-none focus-visible:ring-3",
              theme === option.value
                ? "border-primary/40 bg-primary/[0.05] font-medium"
                : "border-border hover:bg-muted/50"
            )}
          >
            <option.icon className="size-4" />
            {option.label}
          </button>
        ))}
      </div>
    </section>
  )
}
