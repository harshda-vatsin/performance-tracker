import { useState, type ReactNode } from 'react';
import { Toasts } from '../ui';
import { DemoGuide } from './DemoGuide';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  const [guide, setGuide] = useState(false);
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onGuide={() => setGuide(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-4 py-5 md:px-6 md:py-6">{children}</div>
        </main>
      </div>
      <DemoGuide open={guide} onClose={() => setGuide(false)} />
      <Toasts />
    </div>
  );
}
