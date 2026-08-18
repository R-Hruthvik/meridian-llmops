import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import { api } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getLLMSettings: vi.fn(),
    updateLLMSettings: vi.fn(),
    testAndFetchModels: vi.fn(),
  },
}));

describe('SettingsModal - Security: No API keys in localStorage', () => {
  const mockSettings = {
    active_provider: 'openai',
    default_model: 'gpt-4o-mini',
    litellm_base_url: 'http://localhost:4000',
    openai_org_id: 'org-test',
    openai_proj_id: 'proj-test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);
  });

  it('does not write provider API keys to localStorage on save', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        platformApiKey=""
        onSavePlatformApiKey={onSave}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Type a fake OpenAI key (non-masked)
    const openaiInput = screen.getByPlaceholderText('sk-proj-...');
    await user.type(openaiInput, 'sk-proj-abc123');

    // Click save
    const saveButton = screen.getByRole('button', { name: /Save & Apply/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          openai_api_key: expect.stringContaining('sk-proj-abc123'),
        }),
      );
    });

    // Verify NO provider keys were written to localStorage
    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
    expect(localStorage.getItem('meridian_groq_key')).toBeNull();
    expect(localStorage.getItem('meridian_api_key')).toBeNull();
  });

  it('only persists non-sensitive preferences to localStorage', async () => {
    const user = userEvent.setup();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        platformApiKey=""
        onSavePlatformApiKey={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    const saveButton = screen.getByRole('button', { name: /Save & Apply/i });
    await user.click(saveButton);

    await waitFor(() => {
      // Only non-sensitive config should be in localStorage
      expect(localStorage.getItem('meridian_active_provider')).toBe('openai');
      expect(localStorage.getItem('meridian_default_model')).toBe('gpt-4o-mini');
    });

    // No keys should ever be stored
    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
    expect(localStorage.getItem('meridian_groq_key')).toBeNull();
    expect(localStorage.getItem('meridian_api_key')).toBeNull();
  });

  it('does not read provider API keys from localStorage on open', async () => {
    // Pre-populate localStorage with old-style keys
    localStorage.setItem('meridian_openai_key', 'sk-old-key-123');
    localStorage.setItem('meridian_anthropic_key', 'sk-ant-old-key');
    localStorage.setItem('meridian_groq_key', 'gsk_old_key');
    localStorage.setItem('meridian_api_key', 'meridian-test-secret-key-2026');

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        platformApiKey=""
        onSavePlatformApiKey={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Input fields should NOT be pre-filled with old localStorage keys
    const openaiInput = screen.getByPlaceholderText('sk-proj-...') as HTMLInputElement;
    expect(openaiInput.value).not.toContain('sk-old-key-123');
  });

  it('sends keys to backend API instead of localStorage', async () => {
    const user = userEvent.setup();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        platformApiKey=""
        onSavePlatformApiKey={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Type OpenAI key (provider defaults to 'openai')
    await user.type(screen.getByPlaceholderText('sk-proj-...'), 'sk-proj-test-key');

    // Switch to Anthropic provider to expose the Anthropic key input
    const providerSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(providerSelect, 'anthropic');

    await user.type(screen.getByPlaceholderText('sk-ant-...'), 'sk-ant-test-key');

    const saveButton = screen.getByRole('button', { name: /Save & Apply/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          openai_api_key: expect.stringContaining('sk-proj-test-key'),
          anthropic_api_key: expect.stringContaining('sk-ant-test-key'),
        }),
      );
    });

    // Keys should NOT be in localStorage even momentarily after save
    expect(localStorage.getItem('meridian_openai_key')).toBeNull();
    expect(localStorage.getItem('meridian_anthropic_key')).toBeNull();
  });

  it('does not populate input fields with masked backend keys', async () => {
    const maskedSettings = {
      active_provider: 'openai',
      openai_api_key: 'sk-pr...xyz',
      default_model: 'gpt-4o-mini',
      litellm_base_url: 'http://localhost:4000',
    };

    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(maskedSettings);

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        platformApiKey=""
        onSavePlatformApiKey={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Input fields should remain empty — masked values are not usable
    const openaiInput = await screen.findByPlaceholderText('sk-proj-...') as HTMLInputElement;
    expect(openaiInput.value).toBe('');
  });

  it('renders save button with loading state', async () => {
    const user = userEvent.setup();

    // Make updateLLMSettings hang to test loading state
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        platformApiKey=""
        onSavePlatformApiKey={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    const saveButton = screen.getByRole('button', { name: /Save & Apply/i });
    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
  });

  it('closes modal on successful save', async () => {
    const user = userEvent.setup();
    const mockOnClose = vi.fn();

    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockSettings);

    render(
      <SettingsModal
        isOpen={true}
        onClose={mockOnClose}
        platformApiKey=""
        onSavePlatformApiKey={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    const saveButton = screen.getByRole('button', { name: /Save & Apply/i });
    await user.click(saveButton);

    // Wait for auto-close timeout (700ms)
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    }, { timeout: 1000 });
  });
});
