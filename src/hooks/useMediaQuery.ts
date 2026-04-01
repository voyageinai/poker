'use client';
import { useState, useEffect, useSyncExternalStore } from 'react';

function subscribe(query: string, callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(query: string) {
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  // useSyncExternalStore with getServerSnapshot = false
  // This avoids the useEffect delay — matches immediately on first client render
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => getSnapshot(query),
    () => false, // SSR fallback
  );
}

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
}
