'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { stripBasePath, withBasePath } from '@/lib/runtime-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Logo from '@/components/Logo';
import { cn } from '@/lib/utils';
import { Menu, X, Gift } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMediaQuery';

const links = [
  { href: '/',            label: '大厅' },
];

export default function Nav() {
  const pathname = stripBasePath(usePathname());
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="flex h-11 md:h-10 items-center gap-2 border-b border-[var(--border)] bg-bg-base px-3 md:px-4">
      <Logo />

      {!isMobile && links.map(({ href, label }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'relative rounded px-2 py-1 text-[0.85rem] no-underline transition-colors',
              active
                ? 'font-medium text-teal'
                : 'font-normal text-text-muted hover:text-text-primary'
            )}
          >
            {label}
            {active && (
              <motion.div
                layoutId="nav-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-teal"
              />
            )}
          </Link>
        );
      })}

      <div className="flex-1" />

      {isMobile ? <MobileAuthArea menuOpen={menuOpen} setMenuOpen={setMenuOpen} /> : <AuthArea />}
    </nav>
  );
}

/** Dispatch this event from anywhere to refresh the Nav chip display. */
export function refreshNavChips() {
  window.dispatchEvent(new Event('chips-changed'));
}

function MobileAuthArea({ menuOpen, setMenuOpen }: { menuOpen: boolean; setMenuOpen: (v: boolean) => void }) {
  const [user, setUser] = useState<{ username: string; chips: number; role: string } | null>(null);

  const fetchUser = useCallback(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(r => r.ok ? r.json() as Promise<{ username: string; chips: number; role: string }> : null)
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    fetchUser();
    window.addEventListener('chips-changed', fetchUser);
    const iv = setInterval(fetchUser, 15_000);
    return () => {
      window.removeEventListener('chips-changed', fetchUser);
      clearInterval(iv);
    };
  }, [fetchUser]);

  if (!user) {
    return (
      <Link href="/login" className="no-underline">
        <Button variant="outline" size="sm" className="h-8 text-xs">
          登录
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="mono text-[0.8rem] font-semibold text-amber">{user.chips.toLocaleString()}</span>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex h-9 w-9 items-center justify-center rounded border-none bg-transparent text-text-primary"
      >
        {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="fixed left-0 right-0 top-11 z-50 border-b border-[var(--border)] bg-bg-surface px-4 py-3"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-medium text-text-primary">{user.username}</span>
                {user.role === 'admin' && (
                  <Link href="/admin" className="text-xs text-amber no-underline" onClick={() => setMenuOpen(false)}>
                    管理
                  </Link>
                )}
              </div>
              <MobileRedeemForm />
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-text-muted h-11"
                onClick={async () => {
                  await fetch(withBasePath('/api/auth/logout'), { method: 'POST' });
                  window.location.href = withBasePath('/');
                }}
              >
                退出
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MobileRedeemForm() {
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeemLoading(true);
    try {
      const res = await fetch(withBasePath('/api/redeem'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: redeemCode.trim() }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '兑换失败');
      refreshNavChips();
      toast.success('操作成功');
      setRedeemCode('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRedeemLoading(false);
    }
  }

  return (
    <form onSubmit={handleRedeem} className="flex items-center gap-2">
      <Gift className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <Input
        value={redeemCode}
        onChange={e => setRedeemCode(e.target.value)}
        placeholder="兑换码"
        className="h-8 flex-1 text-sm"
      />
      <Button type="submit" variant="teal" size="sm" disabled={redeemLoading} className="h-8 text-xs">
        {redeemLoading ? '...' : '兑换'}
      </Button>
    </form>
  );
}

function AuthArea() {
  const [user, setUser] = useState<{ username: string; chips: number; role: string } | null>(null);
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);

  const fetchUser = useCallback(() => {
    fetch(withBasePath('/api/auth/me'))
      .then(r => r.ok ? r.json() as Promise<{ username: string; chips: number; role: string }> : null)
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    fetchUser();
    window.addEventListener('chips-changed', fetchUser);
    const iv = setInterval(fetchUser, 15_000);
    return () => {
      window.removeEventListener('chips-changed', fetchUser);
      clearInterval(iv);
    };
  }, [fetchUser]);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setRedeemLoading(true);
    try {
      const res = await fetch(withBasePath('/api/redeem'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: redeemCode.trim() }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '兑换失败');
      refreshNavChips();
      toast.success('操作成功');
      setShowRedeem(false);
      setRedeemCode('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRedeemLoading(false);
    }
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        {user.role === 'admin' && (
          <Link href="/admin" className="text-[0.8rem] text-amber no-underline hover:text-amber/80">
            管理
          </Link>
        )}
        <span className="mono text-[0.8rem] font-semibold text-amber">{user.chips.toLocaleString()}</span>

        {showRedeem ? (
          <form onSubmit={handleRedeem} className="flex items-center gap-1">
            <Input
              value={redeemCode}
              onChange={e => setRedeemCode(e.target.value)}
              placeholder="兑换码"
              className="h-6 w-24 text-xs"
              autoFocus
            />
            <Button type="submit" variant="teal" size="xs" disabled={redeemLoading}>
              {redeemLoading ? '...' : '确认'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => { setShowRedeem(false); setRedeemCode(''); }}
            >
              ✕
            </Button>
          </form>
        ) : (
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowRedeem(true)}
          >
            兑换
          </Button>
        )}

        <span className="text-[0.85rem] font-medium text-text-primary">{user.username}</span>
        <Button
          variant="outline"
          size="xs"
          onClick={async () => {
            await fetch(withBasePath('/api/auth/logout'), { method: 'POST' });
            window.location.href = withBasePath('/');
          }}
          className="text-text-muted"
        >
          退出
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link href="/login" className="no-underline">
        <Button variant="outline" size="sm">
          登录
        </Button>
      </Link>
    </div>
  );
}
