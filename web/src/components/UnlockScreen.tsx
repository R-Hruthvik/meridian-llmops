import { useState, type FormEvent } from 'react';
import { Crosshair, KeyRound } from 'lucide-react';

interface UnlockScreenProps {
  onUnlock: (key: string) => void;
}

export function UnlockScreen({ onUnlock }: UnlockScreenProps) {
  const [key, setKey] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = key.trim();
    if (value) onUnlock(value);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 text-ink">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-md border border-hairline bg-surface-raised p-6"
      >
        <div className="mb-6 flex items-center gap-2">
          <Crosshair className="size-4 text-accent" aria-hidden="true" />
          <span className="text-body font-bold tracking-tight">Meridian</span>
          <span className="label-section text-faint">Workbench</span>
        </div>
        <KeyRound className="mb-3 size-5 text-accent" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Unlock Meridian</h1>
        <p className="mt-1 text-sm text-muted">Enter your API key to continue.</p>
        <label className="mt-5 block text-sm font-medium" htmlFor="unlock-api-key">API key</label>
        <input
          id="unlock-api-key"
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          required
          className="mt-1 w-full rounded-sm border border-hairline bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-sm bg-accent px-3 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
