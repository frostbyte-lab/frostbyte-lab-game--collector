/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0a0a0a',
    tint: '#2f95dc',

    // Core surfaces
    background: '#08111f',
    foreground: '#eef5ff',

    // Cards / elevated surfaces
    card: '#101e31',
    cardForeground: '#eef5ff',

    // Primary action color (buttons, links, active states)
    primary: '#5aa9ff',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#182b44',
    secondaryForeground: '#d9e8ff',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#14253b',
    mutedForeground: '#8ca4c2',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#1b385d',
    accentForeground: '#bfe0ff',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#213a59',
    input: '#294566',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
