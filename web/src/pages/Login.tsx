import { useEffect, useRef, useState } from 'react';
import { saveTokens } from '../auth';

type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
};

export function Login() {
  const [code, setCode] = useState<DeviceCode>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    setError(undefined);
    setCode(undefined);
    (async () => {
      try {
        const res = await fetch('/api/auth/device', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error_description || data.error || 'Could not start sign-in');
        if (!alive) return;
        setCode(data);
        let interval = (data.interval || 5) * 1000;
        const deadline = Date.now() + data.expires_in * 1000;
        const poll = async () => {
          if (!alive) return;
          if (Date.now() > deadline) return setAttempt((a) => a + 1); // new code
          const r = await fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: data.device_code }),
          });
          const t = await r.json();
          if (t.access_token) return saveTokens(t);
          if (t.error === 'slow_down') interval += 5000;
          else if (t.error && t.error !== 'authorization_pending') {
            setError(t.error_description || t.error);
            return;
          }
          timer.current = window.setTimeout(poll, interval);
        };
        timer.current = window.setTimeout(poll, interval);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [attempt]);

  return (
    <div className="login">
      <div className="logo big">
        <span className="logo-mark">▶</span> MyTube
      </div>
      {code && (
        <>
          <p>On your phone or computer, go to</p>
          <div className="login-url">{code.verification_url.replace(/^https?:\/\//, '')}</div>
          <p>and enter this code</p>
          <div className="login-code">{code.user_code}</div>
          <p className="muted">Waiting for you to sign in…</p>
        </>
      )}
      {!code && !error && <div className="spinner" />}
      {error && (
        <>
          <p className="error">{error}</p>
          <button className="btn primary focusable" data-autofocus onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
