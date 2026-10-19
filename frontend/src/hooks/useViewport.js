import { useState, useEffect } from 'react';

const getBreakpoint = (width) => {
  if (width < 480) return 'xs';
  if (width < 640) return 'sm';
  if (width < 768) return 'md';
  if (width < 1024) return 'lg';
  if (width < 1280) return 'xl';
  return '2xl';
};

const readBrowserViewport = () => {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 800,
      breakpoint: 'xl',
      isXS: false,
      isMobile: false,
      isCompact: false,
      isTablet: false,
      isDesktop: true,
      isTouch: false,
      orientation: 'landscape',
      devicePixelRatio: 1,
    };
  }

  const vv = window.visualViewport;
  const width = Math.round(vv ? vv.width : window.innerWidth);
  const height = Math.round(vv ? vv.height : window.innerHeight);
  const isTouch =
    (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  const orientation = width >= height ? 'landscape' : 'portrait';
  const breakpoint = getBreakpoint(width);

  return {
    width,
    height,
    breakpoint,
    isXS: width < 480,
    isMobile: width < 640,
    isCompact: width < 768,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
    isTouch,
    orientation,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
};

export function useViewport() {
  const [viewport, setViewport] = useState(readBrowserViewport);

  useEffect(() => {
    let rafId = null;

    const syncViewport = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const next = readBrowserViewport();
        document.documentElement.style.setProperty('--app-width', `${next.width}px`);
        document.documentElement.style.setProperty('--app-height', `${next.height}px`);
        document.documentElement.dataset.breakpoint = next.breakpoint;
        document.documentElement.dataset.touch = next.isTouch ? 'true' : 'false';
        setViewport((prev) => {
          if (
            prev.width === next.width &&
            prev.height === next.height &&
            prev.isTouch === next.isTouch &&
            prev.orientation === next.orientation
          ) {
            return prev;
          }
          return next;
        });
      });
    };

    syncViewport();

    window.addEventListener('resize', syncViewport, { passive: true });
    window.addEventListener('orientationchange', syncViewport, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport, { passive: true });
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', syncViewport);
      }
    };
  }, []);

  return viewport;
}
