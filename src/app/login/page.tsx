'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      {/* Diagonal line pattern background */}
      <div
        className="fixed inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, var(--gold-dim) 0px, var(--gold-dim) 1px, transparent 1px, transparent 40px)',
        }}
      />

      {/* Crimson radial glow */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at center, rgba(220,38,38,0.06), transparent 70%)',
        }}
      />

      <div className="w-full max-w-[420px] mx-3 md:mx-0">
        {/* Gold top accent */}
        <div className="h-[2px] rounded-t-xl bg-gradient-to-r from-transparent via-gold-dim to-transparent" />

        <div className="rounded-b-xl bg-bg-surface border border-[var(--border)] border-t-0 p-6 md:p-8 shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
          {/* Logo */}
          <div className="mb-8 text-center">
            <Logo size="lg" />
            <p className="mt-2 text-xs text-text-muted tracking-wider">德州扑克竞技场</p>
          </div>

          {/* Tabs — pill style */}
          <div className="mb-6 flex gap-1 rounded-lg bg-bg-base p-1">
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 cursor-pointer border-none rounded-md py-2 text-sm font-medium transition-all',
                  tab === t
                    ? 'bg-bg-card text-text-primary shadow-sm'
                    : 'bg-transparent text-text-muted hover:text-text-secondary'
                )}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs text-text-muted font-medium tracking-wide">用户名</label>
              <Input value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" className="h-10" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-text-muted font-medium tracking-wide">密码</label>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                className="h-10"
              />
            </div>
            {tab === 'register' && (
              <div>
                <label className="mb-1.5 block text-xs text-text-muted font-medium tracking-wide">邀请码</label>
                <Input
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  placeholder="注册需要邀请码"
                  className="h-10"
                />
              </div>
            )}
            {error && <div className="text-sm text-loss bg-loss/8 rounded-md px-3 py-2">{error}</div>}
            <Button type="submit" disabled={loading} variant="teal" className="mt-1 h-11 text-base font-bold tracking-wider">
              {loading ? '...' : TAB_LABELS[tab]}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
