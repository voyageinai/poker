import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import { Toaster } from 'sonner';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: '德州风云 — 德州扑克竞技场',
  description: '四大名著群英荟萃的德州扑克竞技场。与司马懿斗智，同孙悟空交锋，在牌桌上论英雄。',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-bg-base min-h-screen">
        <Nav />
        <main className="mx-auto max-w-[1400px] px-2 md:px-4">
          {children}
        </main>
        <Toaster
          theme="dark"
          toastOptions={{
            style: {
              background: 'var(--bg-card)',
              border: '1px solid var(--border-bright)',
              color: 'var(--text-primary)',
            },
          }}
        />
      </body>
    </html>
  );
}
