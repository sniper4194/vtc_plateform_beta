import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useFetch<T>(path: string, everyMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await api<T>(path)); setError(""); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, error, loading, reload: load };
}
