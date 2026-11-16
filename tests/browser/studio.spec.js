import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { createSettings, encodeSettings } from '../../src/lib/settings.js';

async function boot(page) {
  await page.goto('/');
  await expect.poll(() => page.locator('html').getAttribute('data-renderer')).toBe('ready');
}

test('boots a real WebGL2 renderer without browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await expect(page.locator('[data-app="aetherfield"]')).toBeVisible();
  await expect(page.locator('canvas#field')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.aetherfield.engine.getStats().frames)).toBeGreaterThan(5);
  const captureSize = await page.evaluate(() => document.querySelector('#field').toDataURL('image/png').length);
  expect(captureSize).toBeGreaterThan(10000);
  expect(errors).toEqual([]);
});

test('studio controls change the live simulation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);

  await page.locator('[data-preset="solaris"]').click();
  await expect(page.locator('[data-preset="solaris"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.aetherfield.getState().settings.preset)).toBe('solaris');
  await expect(page.locator('#preset-name')).toHaveText('Solaris');

  await page.locator('#flow').focus();
  await page.locator('#flow').press('End');
  expect(await page.evaluate(() => window.aetherfield.getState().settings.flow)).toBe(2);
  await expect(page.locator('#flow-value')).toHaveText('2.00');

  await page.locator('#play-toggle').click();
  expect(await page.evaluate(() => window.aetherfield.getState().isPlaying)).toBe(false);
  const pausedFrames = await page.evaluate(() => window.aetherfield.engine.getStats().frames);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.aetherfield.engine.getStats().frames)).toBe(pausedFrames);
  await page.locator('#play-toggle').click();

  await page.locator('#pointer-mode').click();
  expect(await page.evaluate(() => window.aetherfield.getState().pointerPolarity)).toBe(-1);
  await expect(page.locator('#pointer-mode')).toContainText('Repel');

  const previousSeed = await page.evaluate(() => window.aetherfield.getState().settings.seed);
  await page.locator('#randomize').click();
  expect(await page.evaluate(() => window.aetherfield.getState().settings.seed)).not.toBe(previousSeed);

  await page.locator('#particle-count').selectOption('60000');
  expect(await page.evaluate(() => window.aetherfield.engine.getStats().count)).toBe(60000);

  await page.locator('#color-a').evaluate((input) => {
    input.value = '#010203';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.aetherfield.getState().settings.colors[0])).toBe('#010203');
  expect(errors).toEqual([]);
});

test('share, PNG capture, and video recording produce real artifacts', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedText = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => { window.__copiedText = text; } },
    });
  });
  await boot(page);

  await page.locator('#share').click();
  await expect(page).toHaveURL(/#field=/);
  expect(await page.evaluate(() => window.__copiedText)).toContain('#field=');

  const pngDownload = page.waitForEvent('download');
  await page.locator('#export-png').click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toMatch(/^aetherfield-nebula-.*\.png$/);
  expect(await png.failure()).toBeNull();
  expect((await stat(await png.path())).size).toBeGreaterThan(10000);

  await page.locator('#record').click();
  await expect(page.locator('#record')).toHaveAttribute('data-recording', 'true');
  await page.waitForTimeout(800);
  const videoDownload = page.waitForEvent('download');
  await page.locator('#record').click();
  const video = await videoDownload;
  expect(video.suggestedFilename()).toMatch(/\.(webm|mp4)$/);
  expect(await video.failure()).toBeNull();
  expect((await stat(await video.path())).size).toBeGreaterThan(1000);
});

test('keyboard, about dialog, and mobile controls remain usable', async ({ page }) => {
  await boot(page);

  await page.locator('#about-open').click();
  await expect(page.locator('#about')).toBeVisible();
  await expect(page.locator('#build-credit')).toContainText('Kimi 3.1 Pro');
  await expect(page.locator('#build-credit')).toContainText('One-shot concept');
  await page.keyboard.press('Escape');
  await expect(page.locator('#about')).not.toBeVisible();

  await page.locator('#field').click({ position: { x: 400, y: 350 } });
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.aetherfield.getState().isPlaying)).toBe(false);
  await page.keyboard.press('h');
  await expect(page.locator('body')).toHaveAttribute('data-ui-hidden', 'true');
  await page.keyboard.press('h');
  await expect(page.locator('body')).toHaveAttribute('data-ui-hidden', 'false');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#controls-toggle')).toBeVisible();
  await expect(page.locator('#control-panel')).not.toBeVisible();
  await page.locator('#controls-toggle').click();
  await expect(page.locator('#control-panel')).toBeVisible();
  await expect(page.locator('#controls-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('mobile controls are touch-sized and stay inside the viewport', async ({ page }) => {
  await boot(page);

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('#controls-toggle')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    const selectors = ['.top-actions button', '.transport button', '#controls-toggle'];
    for (const selector of selectors) {
      const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
      }));
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(40);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    }
  }
});

test('pointer movement, pressure, and leaving the canvas drive the live force', async ({ page }) => {
  await boot(page);
  await page.mouse.move(720, 500);
  await expect.poll(() => page.evaluate(() => window.aetherfield.engine.pointer.strength)).toBe(0.4);

  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.aetherfield.engine.pointer.strength)).toBe(1.5);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.aetherfield.engine.pointer.strength)).toBe(0.4);

  await page.mouse.move(1250, 300);
  await expect.poll(() => page.evaluate(() => window.aetherfield.engine.pointer.strength)).toBe(0);
});

test('a shared URL restores the complete field after a fresh load', async ({ page }) => {
  const shared = createSettings({ preset: 'monolith', seed: 'shared 🪐 orbit', flow: 1.23, trail: 0.9 });
  await page.goto(`/#field=${encodeSettings(shared)}`);
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');
  expect(await page.evaluate(() => window.aetherfield.getState().settings)).toEqual(shared);
  await expect(page.locator('#preset-name')).toHaveText('Monolith');
  await expect(page.locator('#header-seed')).toHaveText('SHARED 🪐 ORBIT');
});

test('reduced motion starts paused and allows deliberate playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  expect(await page.evaluate(() => window.aetherfield.getState().isPlaying)).toBe(false);
  await expect(page.locator('#play-toggle')).toHaveAttribute('aria-label', 'Resume field');
  await page.locator('#play-toggle').click();
  expect(await page.evaluate(() => window.aetherfield.getState().isPlaying)).toBe(true);
});

test('unsupported WebGL2 shows a truthful compatibility message', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2') return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'error');
  await expect(page.locator('#unsupported')).toBeVisible();
  await expect(page.locator('#unsupported-message')).toContainText('WebGL2');
  expect(await page.evaluate(() => window.aetherfield)).toBeUndefined();
});

test('paused fields render only after an invalidating control change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const engine = window.aetherfield.engine;
    const render = engine.render.bind(engine);
    window.__qaRenderCount = 0;
    engine.render = (...args) => {
      window.__qaRenderCount += 1;
      return render(...args);
    };
  });

  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__qaRenderCount)).toBe(0);

  await page.locator('#flow').press('End');
  await expect.poll(() => page.evaluate(() => window.__qaRenderCount)).toBeGreaterThan(0);
  await page.evaluate(() => { window.__qaRenderCount = 0; });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__qaRenderCount)).toBe(0);
});
