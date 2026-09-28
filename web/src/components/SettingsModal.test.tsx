import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import { api, ApiError } from '../services/api';

vi.mock('../services/api', () => ({
  api: {
    getLLMSettings: vi.fn(),
    updateLLMSettings: vi.fn(),
    testAndFetchModels: vi.fn(),
    testLLMConnection: vi.fn(),
    getProviders: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public detail?: string) {
      super(message);
      this.name = 'ApiError';
    }
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
    (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ active_provider: 'openai', providers: [] });
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

  it('closes modal on successful save', async () => {    const user = userEvent.setup();
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

describe('SettingsModal - masked settings contract (F1/F2/F3/F5)', () => {
  const mockGet = {
    active_provider: 'openai',
    default_model: 'gpt-4o-mini',
    custom_base_url: 'https://api.groq.com/openai/v1',
    providers_configured: { openai: true, anthropic: false, groq: true, custom: false, ollama: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockGet);
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockGet);
    (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ active_provider: 'openai', providers: [] });
  });

  it('F1: save payload drops openai_proj_id and litellm_base_url', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Project ID stays test-call-only: fill it, it must not reach the save payload
    await user.type(screen.getByPlaceholderText('proj-...'), 'proj-should-stay-local');
    // LiteLLM gateway URL input was removed (not a backend settings field)
    expect(screen.queryByLabelText(/LiteLLM Gateway Base URL/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalled();
    });
    const payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty('openai_proj_id');
    expect(payload).not.toHaveProperty('litellm_base_url');
  });

  it('F2: custom_api_key/custom_base_url only for the OpenAI-compatible family', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Default provider openai: no custom fields even though defaults are set
    const saveButton = screen.getByRole('button', { name: /Save & Apply/i });
    await user.click(saveButton);
    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalled();
    });
    let payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty('custom_api_key');
    expect(payload).not.toHaveProperty('custom_base_url');

    // Groq: both custom fields sent
    vi.clearAllMocks();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockGet);
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockGet);
    (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ active_provider: 'openai', providers: [] });
    // Success state disables Save for 600ms — wait for re-enable before re-saving
    await waitFor(() => expect(saveButton).not.toBeDisabled(), { timeout: 2000 });
    const providerSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(providerSelect, 'groq');
    await user.type(screen.getByPlaceholderText(/Enter API key or leave blank/i), 'gsk-test-key');
    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));
    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalled();
    });
    payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.groq_api_key).toBe('gsk-test-key');
    expect(payload.custom_api_key).toBe('gsk-test-key');
    expect(payload.custom_base_url).toBeTruthy();
  });

  it('F2: ollama sends custom_base_url but never a key', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    const providerSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(providerSelect, 'ollama');
    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalled();
    });
    const payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.custom_base_url).toBe('http://localhost:11434');
    expect(payload).not.toHaveProperty('custom_api_key');
  });

  it('F3: shows per-provider Configured status without filling password inputs', async () => {
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    expect(await screen.findByText((_content, el) => el?.textContent === 'Configured ••••')).toBeInTheDocument();
    const openaiInput = screen.getByPlaceholderText('sk-proj-...') as HTMLInputElement;
    expect(openaiInput.value).toBe('');
  });

  it('F5: surfaces 422 detail inline on save failure', async () => {
    const user = userEvent.setup();
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('openai_proj_id: Extra inputs are not permitted', 422, 'openai_proj_id: Extra inputs are not permitted'),
    );

    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));

    expect(await screen.findByText(/Extra inputs are not permitted/)).toBeInTheDocument();
  });
});

describe('SettingsModal - advanced settings + quick ping (G4/G5)', () => {
  const mockGet = {
    active_provider: 'openai',
    default_model: 'gpt-4o-mini',
    providers_configured: { openai: true, ollama: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (api.getLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockGet);
    (api.updateLLMSettings as ReturnType<typeof vi.fn>).mockResolvedValue(mockGet);
    (api.getProviders as ReturnType<typeof vi.fn>).mockResolvedValue({ active_provider: 'openai', providers: [] });
    (api.testLLMConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'success',
      message: 'Successfully connected to gpt-4o-mini via openai',
      latency_ms: 87.4,
    });
  });

  it('G4: advanced collapsible wires timeout/max_cycles/guardrails into the save payload', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /Advanced: timeout, guardrails/i }));
    await user.type(screen.getByLabelText(/Timeout \(seconds/i), '60');
    await user.type(screen.getByLabelText(/Max cycles/i), '5');

    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout_seconds: 60,
          max_cycles: 5,
          enforce_guardrails: true,
        }),
      );
    });
  });

  it('G4: blank advanced fields are omitted from the save payload', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalled();
    });
    const payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty('timeout_seconds');
    expect(payload).not.toHaveProperty('max_cycles');
    expect(payload).not.toHaveProperty('enforce_guardrails');
  });

  it('G4: default save omits enforce_guardrails while interacted Advanced includes it', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Default save (Advanced never opened): guardrails must be omitted.
    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));
    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalledTimes(1);
    });
    let payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty('enforce_guardrails');

    // Interacted Advanced (opened, checkbox toggled): guardrails included.
    await waitFor(() => expect(screen.getByRole('button', { name: /Save & Apply/i })).not.toBeDisabled(), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: /Advanced: timeout, guardrails/i }));
    const guardrailsCheckbox = screen.getByRole('checkbox') as HTMLInputElement;
    await user.click(guardrailsCheckbox);
    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));
    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalledTimes(2);
    });
    payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(payload).toHaveProperty('enforce_guardrails', false);
  });

  it('G4: expand Advanced without editing omits all pipeline fields on save', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    // Expand Advanced but change nothing, then save.
    await user.click(screen.getByRole('button', { name: /Advanced: timeout, guardrails/i }));
    expect(screen.getByLabelText(/Timeout \(seconds/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save & Apply/i }));

    await waitFor(() => {
      expect(api.updateLLMSettings).toHaveBeenCalledTimes(1);
    });
    const payload = (api.updateLLMSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).not.toHaveProperty('enforce_guardrails');
    expect(payload).not.toHaveProperty('timeout_seconds');
    expect(payload).not.toHaveProperty('max_cycles');
  });

  it('G5: Quick ping calls testLLMConnection and shows latency inline', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()} platformApiKey="" onSavePlatformApiKey={vi.fn()} />,
    );

    await waitFor(() => {
      expect(api.getLLMSettings).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: /Quick ping/i }));

    await waitFor(() => {
      expect(api.testLLMConnection).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Successfully connected.*87 ms/)).toBeInTheDocument();
  });
});
