import React, { useCallback, useState } from 'react';

export interface PromptChipProps {
  title: string;
  caption: string;
  onClick: (text: string) => void;
}

/** One prompt starter chip. Click → fill input and autofocus; keyboard
 * Enter/Space same action. Selected state rings accent for 1.2 s then clears.
 */
export const PromptChip: React.FC<PromptChipProps> = ({ title, caption, onClick }) => {
  const [selected, setSelected] = useState(false);

  const handleClick = useCallback(() => {
    onClick(title);
    if (selected === false) {
      setSelected(true);
      setTimeout(() => setSelected(false), 1200);
    }
  }, [onClick, title, selected]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <button
      role="option"
      aria-label={`${title}. ${caption}`}
      aria-keyshortcuts="Enter"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        'cockpit-chip group flex min-h-[4rem] flex-col items-start justify-between gap-2 rounded-sm border border-hairline bg-surface px-3 py-3 text-left transition-colors duration-200 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'border-accent bg-accent-wash' : '',
      ].join(' ')}
    >
      <span className="text-body font-medium text-ink">{title}</span>
      <span
        className={[
          'text-micro transition-colors duration-200',
          selected ? 'text-accent-ink' : 'text-muted group-hover:text-ink',
        ].join(' ')}
      >
        {caption}
      </span>
    </button>
  );
};
