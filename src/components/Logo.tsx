import Link from 'next/link';
import { Flame } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'lg';
}

export default function Logo({ size = 'sm' }: LogoProps) {
  const iconSize = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <Link
      href="/"
      className={`group mr-6 font-heading font-bold tracking-[0.15em] text-crimson no-underline inline-flex items-center${size === 'lg' ? ' text-2xl' : ' text-base'}`}
    >
      <Flame className={`inline ${iconSize} text-crimson mr-1.5 shrink-0`} />
      <span
        className="group-hover:glow-text-crimson transition-all"
        style={{ animation: 'logo-glow-pulse 3s ease-in-out infinite' }}
      >
        德州
      </span>
      <span className="text-gold group-hover:glow-text-gold transition-all ml-[0.15em]">
        风云
      </span>
    </Link>
  );
}
