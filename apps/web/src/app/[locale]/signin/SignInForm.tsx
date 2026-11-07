'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';

type Step = 'email' | 'code';
type ErrorKey = 'invalidEmail' | 'invalidCode' | 'sendFailed' | 'rateLimited';

export function SignInForm({ next, mockCode }: { next: string; mockCode: string | null }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  async function post(path: string, body: object) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    return { ok: Boolean(res?.ok), error: data?.error };
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post('/api/auth/otp', { email });
    setBusy(false);
    if (res.ok) setStep('code');
    else setError(res.error === 'invalid_email' ? 'invalidEmail' : res.error === 'rate_limited' ? 'rateLimited' : 'sendFailed');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post('/api/auth/verify', { email, code, locale });
    if (res.ok) {
      // Full navigation so the server renders with the new session cookies.
      window.location.assign(next);
      return;
    }
    setBusy(false);
    setError('invalidCode');
  }

  return (
    <div className="card space-y-4 p-5">
      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-4">
          <label className="block text-sm font-semibold">
            {t('email')}
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field mt-1"
            />
          </label>
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {t('sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm">{t('codeSent', { email })}</p>
          <label className="block text-sm font-semibold">
            {t('code')}
            <input
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]{6,12}"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="field num mt-1 tracking-[0.3em]"
            />
          </label>
          {mockCode && <p className="rounded-xl bg-sand px-3 py-2 text-xs">{t('mockHint', { code: mockCode })}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {t('verify')}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className="font-semibold text-teal hover:underline" onClick={() => { setStep('email'); setCode(''); setError(null); }}>
              {t('changeEmail')}
            </button>
            <button type="button" className="font-semibold text-teal hover:underline" onClick={() => sendCode()} disabled={busy}>
              {t('resend')}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="text-sm font-semibold text-coral" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
