import { Sidebar } from '@/components/layout/sidebar'
import { PrivacyBanner } from '@/components/dashboard/privacy-banner'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 lg:p-8">
        {children}
      </main>
      <PrivacyBanner />
    </div>
  )
}
