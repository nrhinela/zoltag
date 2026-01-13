// Helper to inject Tailwind CSS into LitElement components
import { css } from 'lit';
import tailwindRaw from './tailwind-output.css?raw';
export const tailwind = css([tailwindRaw]);
