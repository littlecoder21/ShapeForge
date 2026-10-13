import { useEffect, useState } from 'react';

/** Reactive `matchMedia` — used to pick the phone / tablet / desktop layout in JS (avoids duplicate DOM). */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query), on = () => setMatches(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
