import { useCallback, useEffect, useState } from 'react';

const FEED_LIMIT = 100;

// Live status, character and event feed pushed by the server over SSE (/api/stream).
// EventSource reconnects on its own; the server resends full state on every connect.
// overlay: the overlay app window, which also takes the screenshots the server asks for
export function useLiveData({ overlay = false, onCaptureRequest } = {}) {
  const [status, setStatus] = useState(null);
  const [character, setCharacter] = useState(null);
  const [feed, setFeed] = useState([]);
  const [connected, setConnected] = useState(false);
  const [optimizer, setOptimizer] = useState({ result: null, progress: null });
  const [talentAdvice, setTalentAdvice] = useState({ result: null, progress: null });
  // The sample build when it changes on the server, and progress of its long tasks
  const [sample, setSample] = useState(null);
  const [sampleProgress, setSampleProgress] = useState(null);
  // Screenshots of the game (the planner takes them as pages the log names come up)
  const [captures, setCaptures] = useState([]);
  // The farming tracker: current map, session totals, notable drops (server/farm)
  const [farm, setFarm] = useState(null);
  // The public market client's status (server/cloud): sharing on/off, prices downloaded
  const [cloud, setCloud] = useState(null);

  useEffect(() => {
    const es = new EventSource(overlay ? '/api/stream?client=overlay' : '/api/stream');
    const on = (event, fn) => es.addEventListener(event, (e) => fn(JSON.parse(e.data)));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    on('status', setStatus);
    on('character', setCharacter);
    on('feed', setFeed);
    on('feedEntry', (entry) => setFeed((f) => [...f, entry].slice(-FEED_LIMIT)));
    on('optimizerProgress', (progress) => setOptimizer((o) => ({ ...o, progress })));
    on('optimizerResult', (result) => setOptimizer({ result, progress: null }));
    on('talentProgress', (progress) => setTalentAdvice((o) => ({ ...o, progress })));
    on('talentResult', (result) => setTalentAdvice({ result, progress: null }));
    on('sample', setSample);
    on('sampleProgress', setSampleProgress);
    on('captures', setCaptures);
    on('farm', setFarm);
    on('cloud', setCloud);
    if (onCaptureRequest) on('captureRequest', onCaptureRequest);
    return () => es.close();
  }, [overlay, onCaptureRequest]);

  const reloadFeed = useCallback(async () => {
    const res = await fetch('/api/feed');
    setFeed(await res.json());
  }, []);

  return { status, character, feed, connected, reloadFeed, optimizer, talentAdvice, sample, sampleProgress, captures, farm, cloud };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
