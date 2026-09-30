import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

// "What's new under עוד": a new confession or a new "who said it?" quote since this browser last looked.
// First visit only records a baseline, so new members are not greeted with old news.
const KEYS = { confession: 'seen-confession', quiz: 'seen-quiz' } as const;

function read(k: string): number | null {
  try {
    const v = localStorage.getItem(k);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function write(k: string, v: number) {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* storage unavailable */
  }
}

export interface MoreNews {
  confession: boolean;
  quiz: boolean;
  markSeen: () => void;
}

export function useMoreNews(myId: string | undefined, active: boolean): MoreNews {
  const [latest, setLatest] = useState({ confession: 0, quiz: 0 });
  const [news, setNews] = useState({ confession: false, quiz: false });

  useEffect(() => {
    if (!active || !myId) return;
    (async () => {
      const [c, q] = await Promise.all([
        supabase.from('confessions').select('id').order('id', { ascending: false }).limit(1),
        supabase.rpc('quiz_list'),
      ]);
      const cid = (c.data as { id: number }[] | null)?.[0]?.id ?? 0;
      // My own confession is not news to me (RLS shows me only my own anon_authors rows).
      const mine = cid ? (await supabase.from('anon_authors').select('item_id').eq('kind', 'confession').eq('item_id', cid).eq('author_id', myId)).data?.length : 0;
      const quiz = ((q.data as { id: number; grabbed_by: string | null }[] | null) ?? []).find((x) => x.grabbed_by !== myId);
      const qid = quiz?.id ?? 0;
      setLatest({ confession: cid, quiz: qid });
      const sc = read(KEYS.confession);
      const sq = read(KEYS.quiz);
      if (sc === null) write(KEYS.confession, cid);
      if (sq === null) write(KEYS.quiz, qid);
      setNews({ confession: sc !== null && cid > sc && !mine, quiz: sq !== null && qid > sq });
    })();
  }, [myId, active]);

  const markSeen = useCallback(() => {
    write(KEYS.confession, latest.confession);
    write(KEYS.quiz, latest.quiz);
    setNews({ confession: false, quiz: false });
  }, [latest]);

  return { ...news, markSeen };
}
