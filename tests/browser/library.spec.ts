import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
test('owner onboarding, fictional shelves, favorites, mixed collections, and source connection', async ({
  page,
}, info) => {
  const violations: string[] = [];
  page.on('pageerror', (error) => violations.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('Content Security Policy'))
      violations.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Explore the demo/ })).toBeVisible();
  await page.getByRole('button', { name: /Explore the demo/ }).click();
  await expect(page.getByText('DEMO LIBRARY', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your shelves' })).toBeVisible();
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: `docs/screenshots/${info.project.name}-entrance.jpg`,
    fullPage: true,
    type: 'jpeg',
    quality: 75,
  });
  await page.getByRole('button', { name: 'View The Atlas of Quiet Places' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: /Read in source/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Spines', exact: true }).click();
  await expect(page.locator('.shelf-items.spines')).toHaveCount(3);
  await page.getByRole('button', { name: 'Covers', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Create my library', exact: true }).click();
  const setup = await page.getByRole('heading', { name: 'Make this library yours' }).isVisible();
  await page.getByLabel('Username', { exact: true }).fill('reader');
  await page.getByLabel('Password', { exact: true }).fill('browser-fixture-password');
  if (setup) {
    const dir = readFileSync('test-results/e2e-directory.txt', 'utf8');
    await page
      .getByLabel('Setup token', { exact: true })
      .fill(readFileSync(join(dir, 'setup.token'), 'utf8'));
  }
  await page
    .getByRole('button', { name: setup ? 'Create owner account' : 'Sign in', exact: false })
    .click();
  await expect(page.getByRole('heading', { name: 'Your shelves' })).toBeVisible();
  await page.getByRole('button', { name: 'Explore demo library', exact: true }).click();
  await page.getByRole('button', { name: 'View The Atlas of Quiet Places' }).first().click();
  if (await page.getByRole('button', { name: 'Favorite', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Collections', exact: true }).click();
  await page.getByRole('button', { name: '+ New collection', exact: true }).click();
  const name = `Across the shelves ${info.project.name}`;
  await page.getByLabel('Collection name').fill(name);
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Entrance', exact: true }).click();
  for (const title of ['The Atlas of Quiet Places', 'The Observatory']) {
    await page
      .getByRole('button', { name: 'View ' + title, exact: true })
      .first()
      .click();
    await page.getByLabel(name, { exact: true }).check();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Collections', exact: true }).click();
  await page.getByLabel('Collection', { exact: true }).selectOption({ label: name + ' (2)' });
  await expect(page.locator('.shelf-items .item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByLabel('Display name').fill('Fixture comics ' + info.project.name);
  await page.getByLabel('Service', { exact: true }).selectOption('komga');
  await page
    .getByLabel('Server URL', { exact: true })
    .fill(readFileSync('test-results/e2e-source.txt', 'utf8'));
  await page
    .getByLabel('API key / user access token', { exact: true })
    .fill('fixture-secret-not-for-real-use');
  await page.getByLabel('Allow this configured source').check();
  await page.locator('#test-new').click();
  await expect(page.locator('#connection-result')).toContainText('Connection succeeded');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  const connection = page.locator('.connection').filter({
    has: page.getByRole('heading', { name: 'Fixture comics ' + info.project.name, exact: true }),
  });
  await connection.getByRole('button', { name: 'Synchronize', exact: true }).click();
  await expect(connection.locator('.health')).toHaveText('ready', { timeout: 15000 });
  await page.getByRole('button', { name: 'Return to my library', exact: true }).click();
  await page.getByRole('button', { name: 'Comics & manga', exact: true }).first().click();
  await page.getByRole('button', { name: 'View Fixture Comic', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Read in source/ })).toBeEnabled();
  const sourceUrl = readFileSync('test-results/e2e-source.txt', 'utf8') + '/book/comic-1';
  await page.route(sourceUrl, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Fictional source handoff</h1>' }),
  );
  await page.getByRole('button', { name: /Read in source/ }).click();
  await expect(page).toHaveURL(sourceUrl);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Entrance', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('searchbox', { name: 'Search across your library' }).fill('Fixture');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Searching for/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByRole('heading', { name: 'Open your library', exact: true })).toBeVisible();
});
