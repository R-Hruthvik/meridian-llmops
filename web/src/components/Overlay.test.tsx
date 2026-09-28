import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Overlay } from './Overlay';

const Harness = ({ breadcrumb }: { breadcrumb?: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open corpus
      </button>
      <Overlay
        open={open}
        onClose={() => setOpen(false)}
        title="Corpus"
        breadcrumb={breadcrumb ?? 'ASK · VERIFIED GROUNDED'}
      >
        <a href="#/doc-c2bd07cc">doc-c2bd07cc</a>
      </Overlay>
    </>
  );
};

const openOverlay = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /open corpus/i }));
  return screen.getByRole('dialog');
};

describe('Overlay', () => {
  it('renders nothing while closed', () => {
    render(<Overlay open={false} onClose={() => {}} title="Corpus">body</Overlay>);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a modal dialog with the title as its accessible name when open', () => {
    render(<Overlay open onClose={() => {}} title="Corpus">body</Overlay>);

    const dialog = screen.getByRole('dialog', { name: 'Corpus' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('names where it was opened from in the header breadcrumb', () => {
    render(<Overlay open onClose={() => {}} title="Corpus" breadcrumb="ASK · VERIFIED GROUNDED">body</Overlay>);

    expect(screen.getByText('ASK · VERIFIED GROUNDED')).toBeInTheDocument();
  });

  it('dismisses on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openOverlay(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dismisses on scrim click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} title="Corpus">
        body
      </Overlay>,
    );

    await user.click(screen.getByTestId('overlay-scrim'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses from the header close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} title="Corpus">
        body
      </Overlay>,
    );

    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when the panel itself is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Overlay open onClose={onClose} title="Corpus">
        <a href="#/doc-c2bd07cc">doc-c2bd07cc</a>
      </Overlay>,
    );

    await user.click(screen.getByText('doc-c2bd07cc'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open and returns it to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /open corpus/i });

    const dialog = await openOverlay(user);
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps Tab focus cycling inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openOverlay(user);
    const focusables = dialog.querySelectorAll('a[href], button:not([disabled])');
    expect(focusables.length).toBeGreaterThan(1);

    focusables[focusables.length - 1].focus();
    await user.tab();

    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
