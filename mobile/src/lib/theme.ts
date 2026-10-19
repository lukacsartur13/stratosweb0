import { useColorScheme } from 'react-native';

/**
 * The Portal's colours (portal/src/styles.css, which lifts them from the
 * site's main.css), so the app and the Portal are one product.
 *
 *   ink    the page            deck   a section
 *   paper  text                haze   secondary text
 *   signal the brand yellow as a fill; signalInk as text or a line (amber on light)
 */
const dark = {
  ink: '#0B0F16',
  deck: '#10161F',
  panel: '#141C27',
  paper: '#F4F4F4',
  haze: '#8A98A8',
  hair: 'rgba(244, 244, 244, 0.10)',
  hairline: 'rgba(244, 244, 244, 0.06)',
  field: 'rgba(0, 0, 0, 0.3)',
  signal: '#FFEE25',
  signalInk: '#FFEE25',
  onSignal: '#0B0F16',
  danger: '#FF5A47',
  good: '#3ECF8E',
};

const light: typeof dark = {
  ink: '#F4F6F9',
  deck: '#FFFFFF',
  panel: '#ECEFF3',
  paper: '#0F141B',
  haze: '#54606E',
  hair: 'rgba(11, 15, 22, 0.14)',
  hairline: 'rgba(11, 15, 22, 0.08)',
  field: '#FFFFFF',
  signal: '#FFEE25',
  signalInk: '#7A6000',
  onSignal: '#0B0F16',
  danger: '#BE2D1C',
  good: '#0C7A4C',
};

export type Palette = typeof dark;

export function usePalette(): Palette {
  return useColorScheme() === 'light' ? light : dark;
}
