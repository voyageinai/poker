import Link from 'next/link';
import { Diamond } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'lg';
}

export default function Logo({ size = 'sm' }: LogoProps) {
  const iconSize = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <Link
      href="/"
      className={`group mr-6 font-extrabold tracking-[0.12em] text-teal no-underline inline-flex items-center${size === 'lg' ? ' text-2xl' : ' text-base'}`}
    >
      <Diamond className={`inline ${iconSize} text-teal mr-1.5 shrink-0`} />
      <span
        className="group-hover:glow-text-teal transition-all"
        style={{ animation: 'logo-glow-pulse 3s ease-in-out infinite' }}
      >
        德州
      </span>
      <span className="text-amber group-hover:glow-text-amber transition-all ml-[0.15em]">
        风云
      </span>
    </Link>
  );
}
