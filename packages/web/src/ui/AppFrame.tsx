import { useEffect, useState, type ReactNode } from 'react';
import { AppHeader, type AppSection } from './sp/components';
import './sp/sp.css';
import './app-frame.css';

const WIDTH = 1672;
const HEIGHT = 941;

/** All three landing pages share the approved statistics-page canvas. */
export function AppFrame({ active, onNav, onSettings, children }: {
  active: AppSection;
  onNav: (section: AppSection) => void;
  onSettings: () => void;
  children: ReactNode;
}) {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const scale = Math.min(size.width / WIDTH, size.height / HEIGHT);
  return <div id="sp-root" data-section={active}>
    <div id="sp-stage" className="app-stage" data-viewport-width={size.width} data-viewport-height={size.height}
      style={{ transform: `scale(${scale})`, left: (size.width-WIDTH*scale)/2, top: (size.height-HEIGHT*scale)/2 }}>
      <AppHeader active={active} onNav={onNav} onSettings={onSettings} />
      {children}
    </div>
  </div>;
}
