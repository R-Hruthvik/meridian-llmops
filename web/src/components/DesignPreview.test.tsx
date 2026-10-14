import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesignPreview } from './DesignPreview';

describe('DesignPreview', () => {
  it('keeps the four labeled destinations navigable without loading the app', async () => {
    const user = userEvent.setup();
    render(<DesignPreview />);

    expect(screen.getByRole('heading', { name: 'Ask Meridian' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ask question/ }));
    expect(screen.getByRole('heading', { name: /Answers are tied back/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retrieval overview/ }));
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Sources/ })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('link', { name: /^Sources/ }));
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByText('Product handbook')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Workspace profile' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search sources' }), 'privacy');
    expect(screen.getByText('Security and privacy guide')).toBeInTheDocument();
    expect(screen.queryByText('Product handbook')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.querySelector('.preview-shell')).toHaveClass('sidebar-collapsed');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });
});
