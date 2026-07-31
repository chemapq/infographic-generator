import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

/**
 * Render determinista: viewport fijo a las dimensiones del original,
 * deviceScaleFactor fijo, animaciones desactivadas y espera a
 * document.fonts.ready antes de capturar. Devuelve PNG.
 */
export async function renderHtml(
  html: string,
  dimensions: { width: number; height: number },
): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: dimensions.width, height: dimensions.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
    });
    // Expresión en string: evita depender de los tipos DOM en un proyecto Node.
    await page.evaluate('document.fonts.ready.then(() => undefined)');
    return await page.screenshot({ type: 'png', fullPage: false });
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}
