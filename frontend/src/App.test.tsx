import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./store/AppContext', () => ({
  AppProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: () => <aside />,
}));

vi.mock('./components/ChatArea', () => ({
  ChatArea: () => <main />,
}));

vi.mock('./components/Toast', () => ({
  ConnectionBanner: () => null,
  Toast: () => null,
}));

describe('App layout', () => {
  it('keeps an 8px gap between the sidebar and main panel', () => {
    const { container } = render(<App />);

    expect(container.firstElementChild?.classList.contains('gap-2')).toBe(true);
    expect(container.firstElementChild?.classList.contains('gap-3')).toBe(false);
  });
});
