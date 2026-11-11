import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { PageIndex, facingPages, fitsSpread } from '../src/core/text/pages';
import { ReadingLayoutPicker, layoutSettings, readingLayout } from '../src/ui/components/ReadingLayout';
import { makeDoc } from './helpers/docs';

const root = document.createElement('div'); document.body.append(root);
afterEach(() => act(() => render(null, root)));

it('offers scroll, one page and a deliberate two-page spread', () => {
  const onChange = vi.fn();
  act(() => render(<ReadingLayoutPicker value="single" onChange={onChange} />, root));
  const select = root.querySelector('select')!;
  expect([...select.options].map((o) => o.textContent)).toEqual(['Scroll', 'One page', 'Two-page spread']);
  expect(select.value).toBe('single');
  act(() => { select.value = 'spread'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(onChange).toHaveBeenCalledWith('spread');
  expect(layoutSettings('spread')).toEqual({ layout: 'pages', twoPages: true });
  for (const choice of ['scroll', 'single', 'spread'] as const) expect(readingLayout(layoutSettings(choice))).toBe(choice);
});

it('shows two pages at ordinary desktop pane widths but does not squeeze a phone or large type', () => {
  expect(fitsSpread(900, 18)).toBe(true);
  expect(fitsSpread(1100, 24)).toBe(true);
  expect(fitsSpread(400, 18)).toBe(false);
  expect(fitsSpread(900, 30)).toBe(false);
});

it('allows reading ahead over chapter boundaries without dropping or duplicating pages', () => {
  const doc = makeDoc([
    { type: 'heading', level: 1, text: 'First chapter' }, { type: 'paragraph', text: 'One short page.' },
    { type: 'heading', level: 1, text: 'Second chapter' }, { type: 'paragraph', text: 'The next page.' },
    { type: 'heading', level: 1, text: 'Third chapter' }, { type: 'paragraph', text: 'An unpaired final page.' },
  ]);
  const pages = new PageIndex(doc).pages;
  expect(pages).toHaveLength(3);
  expect(facingPages(pages, pages[0]!, true)).toEqual(pages.slice(0, 2));
  expect(facingPages(pages, pages[1]!, true)).toEqual(pages.slice(0, 2));
  expect(facingPages(pages, pages[2]!, true)).toEqual([pages[2]]);
  expect(facingPages(pages, pages[1]!, false)).toEqual([pages[1]]);
});
