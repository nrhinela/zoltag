import { css } from 'lit';

export const adminTypography = css`
  :host {
    --zoltag-font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    --zoltag-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-family: var(--zoltag-font-sans);
    color: #1f2937;
  }

  .mono,
  .mono-text,
  .user-email {
    font-family: var(--zoltag-font-mono);
  }
`;
