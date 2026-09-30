import { useLayoutEffect, useRef } from 'react';

/** Keeps a chat list pinned to the bottom for new items, and stable when older items are prepended. */
export function useStickyScroll(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const preserve = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (preserve.current !== null) {
      el.scrollTop = el.scrollHeight - preserve.current;
      preserve.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, deps);

  return {
    ref,
    onScroll: () => {
      const el = ref.current;
      if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    },
    /** Call before prepending older items. */
    keepPosition: () => {
      const el = ref.current;
      if (el) preserve.current = el.scrollHeight - el.scrollTop;
    },
    /** Call before appending your own new item. */
    toBottom: () => {
      stick.current = true;
    },
  };
}
