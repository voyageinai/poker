'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import Logo from '@/components/Logo';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const TAB_LABELS = { login: '登录', register: '注册' } as const;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const url = tab === 'login' ? withBasePath('/api/auth/login') : withBasePath('/api/auth/register');
      const body = tab === 'login' ? { username, password } : { username, password, inviteCode };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '操作失败');
      router.push('/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center">
      {/* Animated grid background */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,180,216,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,216,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          animation: 'rim-shimmer 20s linear infinite',
        }}
      />

      {/* Radial glow centered on the card */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,180,216,0.05), transparent 70%)',
        }}
      />

      <Card className="edge-light w-full max-w-[400px] border-[var(--border)] bg-bg-surface p-5 md:p-8 mx-2 md:mx-0">
        <CardContent className="p-0">
          {/* Logo */}
          <div className="mb-6 text-center">
            <Logo size="lg" />
          </div>

          {/* Tabs — underline style */}
          <div className="mb-6 flex gap-0 border-b border-[var(--border)]">
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 cursor-pointer border-none bg-transparent py-2 text-sm transition-all',
                  tab === t
                    ? 'border-b-2 border-teal font-semibold text-teal -mb-px'
                    : 'font-normal text-text-secondary hover:text-text-primary'
                )}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs text-text-muted">用户名</label>
              <Input value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">密码</label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
            {tab === 'register' && (
              <div>
                <label className="mb-1 block text-xs text-text-muted">邀请码</label>
                <Input
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  placeholder="注册需要邀请码"
                />
              </div>
            )}
            {error && <div className="text-sm text-loss">{error}</div>}
            <Button type="submit" disabled={loading} variant="teal" className="mt-1">
              {loading ? '...' : TAB_LABELS[tab]}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
